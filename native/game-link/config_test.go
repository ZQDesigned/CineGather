package main

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	v1 "github.com/fatedier/frp/pkg/config/v1"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"
)

func fixture() Config {
	return Config{SessionID: "11111111-1111-4111-8111-111111111111", MemberID: "22222222-2222-4222-8222-222222222222", ClientID: "22222222-2222-4222-8222-222222222222", ClientSecret: "01234567890123456789012345678901234567890123", Revision: 1, Role: "host", ExpiresAt: time.Now().Add(25 * time.Second), Server: Server{Host: "games.example.test", Port: 17443, TLSName: "games.example.test", STUNServer: "games.example.test:3478", Issuer: "https://api.example.test/api/v1/game-tunnel/identity", Audience: "cinegather-game"}, Peers: []Peer{{ExpiresAt: time.Now().Add(25 * time.Second), MemberID: "33333333-3333-4333-8333-333333333333", PublisherID: "22222222-2222-4222-8222-222222222222", VisitorID: "33333333-3333-4333-8333-333333333333", Revision: 1, Secret: "01234567890123456789012345678901234567890123"}}, Bindings: []Binding{{MemberID: "33333333-3333-4333-8333-333333333333", P2PPort: 12345, RelayPort: 12346}}}
}
func TestConfigLimitsAndIdentity(t *testing.T) {
	good := fixture()
	if err := good.Validate(false); err != nil {
		t.Fatal(err)
	}
	for _, mutate := range []func(*Config){func(c *Config) { c.Server.Issuer = "http://evil.test/token" }, func(c *Config) { c.MemberID = c.Peers[0].VisitorID }, func(c *Config) { c.Bindings[0].P2PPort = 0 }, func(c *Config) { c.Peers[0].PublisherID = c.Peers[0].VisitorID }, func(c *Config) { c.ExpiresAt = time.Now().Add(time.Hour) }, func(c *Config) { c.Role = "guest" }} {
		c := fixture()
		mutate(&c)
		if err := c.Validate(false); err == nil {
			t.Fatal("invalid config accepted")
		}
	}
	raw, _ := json.Marshal(good)
	var cfg Config
	if err := decodeConfig(append(raw[:len(raw)-1], []byte(`,"proxyType":"tcp"}`)...), &cfg); err == nil {
		t.Fatal("unknown fields accepted")
	}
}
func TestOnlyPairedSTCPXTCPAndLoopbackBindings(t *testing.T) {
	c := fixture()
	common, proxies, visitors, err := buildConfig(c, false, "")
	if err != nil {
		t.Fatal(err)
	}
	if common.Auth.Method != "oidc" || common.Auth.Token != "" || common.WebServer.Port != 0 || common.Auth.OIDC.InsecureSkipVerify {
		t.Fatal("unsafe common config")
	}
	if len(proxies) != 2 || len(visitors) != 0 {
		t.Fatal("host configuration")
	}
	for _, p := range proxies {
		b := p.GetBaseConfig()
		if b.LocalIP != "127.0.0.1" || !b.Transport.UseEncryption || b.Plugin.Type != "" {
			t.Fatal("unsafe proxy")
		}
	}
	c.Role = "guest"
	c.MemberID = c.Peers[0].VisitorID
	c.ClientID = c.MemberID
	c.Bindings = []Binding{}
	c.VisitorPort = 23456
	_, proxies, visitors, err = buildConfig(c, false, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(proxies) != 0 || len(visitors) != 2 {
		t.Fatal("guest configuration")
	}
	x := visitors[1].(*v1.XTCPVisitorConfig)
	if x.FallbackTimeoutMs > 2000 || x.FallbackTo == "" {
		t.Fatal("no bounded relay fallback")
	}
}
func TestGenerationAndExpiryFence(t *testing.T) {
	var fence Fence
	c := fixture()
	if err := fence.Accept(c); err != nil {
		t.Fatal(err)
	}
	c.Revision = 0
	if err := fence.Accept(c); err == nil {
		t.Fatal("stale generation accepted")
	}
	c = fixture()
	c.MemberID = c.Peers[0].MemberID
	if err := fence.Accept(c); err == nil {
		t.Fatal("different membership silently replaced")
	}
}

func TestNDJSONProtocolIsBoundedAndRedacted(t *testing.T) {
	for _, input := range []string{
		`{"id":"one","version":1,"op":"stop"}` + "\n",
		`{"id":"one","version":1,"op":"configure","config":{"clientSecret":"NEVER_PRINT_THIS"}}` + "\n",
		`{"id":"one","version":9,"op":"stop"}` + "\n",
		strings.Repeat("x", 70000) + "\n",
	} {
		var output bytes.Buffer
		run(strings.NewReader(input), &output, false, "")
		if strings.Contains(output.String(), "NEVER_PRINT_THIS") {
			t.Fatal("secret in output")
		}
		for _, line := range strings.Split(strings.TrimSpace(output.String()), "\n") {
			if !json.Valid([]byte(line)) {
				t.Fatal("unstructured output")
			}
		}
	}
}

func TestOldLeaseTimerCannotCloseRenewedAuthorization(t *testing.T) {
	events := 0
	r := Runtime{leaseEpoch: 2, emit: func(any) { events++ }}
	r.expire(1)
	if r.closed || events != 0 {
		t.Fatal("stale timer ended renewed authorization")
	}
	r.expire(2)
	if !r.closed || events != 1 {
		t.Fatal("current authorization did not expire")
	}
}

func TestGameKindIsValidatedAndFenced(t *testing.T) {
	c := fixture()
	c.Game = "stardew-valley"
	if err := c.Validate(false); err != nil {
		t.Fatal(err)
	}
	fence := Fence{}
	if err := fence.Accept(c); err != nil {
		t.Fatal(err)
	}
	c.Game = "minecraft-java"
	if err := fence.Accept(c); err == nil {
		t.Fatal("game silently changed in an existing authorization")
	}
	c.Game = "generic-udp"
	if err := c.Validate(false); err == nil {
		t.Fatal("arbitrary game accepted")
	}
}

func TestConnectorAdvertisesGameProtocolOverVerifiedTLS(t *testing.T) {
	server := httptest.NewUnstartedServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	advertised := make(chan []string, 1)
	server.TLS = &tls.Config{NextProtos: []string{"cinegather-game"}, GetConfigForClient: func(hello *tls.ClientHelloInfo) (*tls.Config, error) {
		advertised <- append([]string(nil), hello.SupportedProtos...)
		return nil, nil
	}}
	server.StartTLS()
	defer server.Close()
	host, port, _ := net.SplitHostPort(server.Listener.Addr().String())
	number, _ := strconv.Atoi(port)
	common, _, _, _ := buildConfig(fixture(), false, "")
	common.ServerAddr, common.ServerPort = host, number
	common.Transport.TLS.ServerName = "example.com"
	roots := x509.NewCertPool()
	roots.AddCert(server.Certificate())
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	connector := Connector{ctx: ctx, cfg: common, roots: roots, emit: func(any) {}}
	conn, err := connector.Connect()
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	protocols := <-advertised
	if len(protocols) != 1 || protocols[0] != "cinegather-game" {
		t.Fatalf("missing game routing protocol: %v", protocols)
	}
}
