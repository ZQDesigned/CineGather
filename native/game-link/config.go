package main

import (
	"bytes"
	"encoding/json"
	"errors"
	v1 "github.com/fatedier/frp/pkg/config/v1"
	"io"
	"net"
	"net/url"
	"regexp"
	"strings"
	"time"
)

type Server struct {
	Host       string `json:"host"`
	Port       int    `json:"port"`
	TLSName    string `json:"tlsName"`
	STUNServer string `json:"stunServer"`
	Issuer     string `json:"issuer"`
	Audience   string `json:"audience"`
}
type Peer struct {
	ExpiresAt   time.Time `json:"expiresAt"`
	MemberID    string    `json:"memberId"`
	Revision    int       `json:"revision"`
	PublisherID string    `json:"publisherId"`
	VisitorID   string    `json:"visitorId"`
	Secret      string    `json:"secret"`
}
type Binding struct {
	MemberID  string `json:"memberId"`
	P2PPort   int    `json:"p2pPort"`
	RelayPort int    `json:"relayPort"`
}
type Config struct {
	SessionID    string    `json:"sessionId"`
	MemberID     string    `json:"memberId"`
	Revision     int       `json:"revision"`
	Role         string    `json:"role"`
	ExpiresAt    time.Time `json:"expiresAt"`
	ClientID     string    `json:"clientId"`
	ClientSecret string    `json:"clientSecret"`
	Server       Server    `json:"server"`
	Peers        []Peer    `json:"peers"`
	Bindings     []Binding `json:"bindings"`
	VisitorPort  int       `json:"visitorPort"`
}

var uuidPattern = regexp.MustCompile(`^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$`)
var hostPattern = regexp.MustCompile(`^[a-zA-Z0-9.:-]{1,253}$`)

func validPort(p int) bool { return p > 0 && p < 65536 }
func decodeConfig(raw []byte, dst any) error {
	if len(raw) > 65536 {
		return errors.New("oversized config")
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if err := d.Decode(dst); err != nil {
		return err
	}
	if d.Decode(new(any)) != io.EOF {
		return errors.New("trailing data")
	}
	return nil
}
func (c Config) Validate(development bool) error {
	invalid := errors.New("invalid game configuration")
	if !uuidPattern.MatchString(c.SessionID) || !uuidPattern.MatchString(c.MemberID) || c.ClientID != c.MemberID || c.Revision < 1 || len(c.ClientSecret) < 32 || len(c.ClientSecret) > 128 || (c.Role != "host" && c.Role != "guest") {
		return invalid
	}
	if delta := time.Until(c.ExpiresAt); delta <= 0 || delta > 32*time.Second {
		return errors.New("expired authorization")
	}
	u, err := url.Parse(c.Server.Issuer)
	if err != nil || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Path != "/api/v1/game-tunnel/identity" || u.Scheme != "https" && !(development && u.Scheme == "http" && u.Hostname() == "127.0.0.1") {
		return invalid
	}
	if !validPort(c.Server.Port) || !hostPattern.MatchString(c.Server.Host) || !hostPattern.MatchString(c.Server.TLSName) || c.Server.Audience != "cinegather-game" {
		return invalid
	}
	if stunHost, stunPort, err := net.SplitHostPort(c.Server.STUNServer); err != nil || stunHost == "" || stunPort == "" {
		return invalid
	}
	if len(c.Peers) > 7 {
		return invalid
	}
	seen := map[string]bool{}
	for _, p := range c.Peers {
		if !uuidPattern.MatchString(p.PublisherID) || !uuidPattern.MatchString(p.VisitorID) || p.MemberID != p.VisitorID || p.PublisherID == p.VisitorID || p.Revision < 1 || len(p.Secret) < 32 || len(p.Secret) > 128 || seen[p.MemberID] {
			return invalid
		}
		seen[p.MemberID] = true
		if c.Role == "host" && p.PublisherID != c.MemberID || c.Role == "guest" && p.VisitorID != c.MemberID {
			return invalid
		}
	}
	if c.Role == "guest" {
		if len(c.Peers) != 1 || len(c.Bindings) != 0 || !validPort(c.VisitorPort) {
			return invalid
		}
	} else {
		if len(c.Bindings) != len(c.Peers) || c.VisitorPort != 0 {
			return invalid
		}
		ports := map[int]bool{}
		members := map[string]bool{}
		for _, b := range c.Bindings {
			if !seen[b.MemberID] || members[b.MemberID] || !validPort(b.P2PPort) || !validPort(b.RelayPort) || b.P2PPort == b.RelayPort || ports[b.P2PPort] || ports[b.RelayPort] {
				return invalid
			}
			ports[b.P2PPort] = true
			ports[b.RelayPort] = true
			members[b.MemberID] = true
		}
	}
	return nil
}
func proxyName(p Peer, route string) string {
	return "cg_" + strings.ReplaceAll(p.VisitorID, "-", "") + "_r" + itoa(p.Revision) + "_" + route
}
func buildConfig(c Config, development bool, caFile string) (*v1.ClientCommonConfig, []v1.ProxyConfigurer, []v1.VisitorConfigurer, error) {
	if err := c.Validate(development); err != nil {
		return nil, nil, nil, err
	}
	common := &v1.ClientCommonConfig{User: c.MemberID, ClientID: c.MemberID, ServerAddr: c.Server.Host, ServerPort: c.Server.Port, LoginFailExit: boolPtr(false), NatHoleSTUNServer: c.Server.STUNServer}
	common.Auth.Method = "oidc"
	common.Auth.AdditionalScopes = []v1.AuthScope{"HeartBeats", "NewWorkConns"}
	common.Auth.OIDC = v1.AuthOIDCClientConfig{ClientID: c.ClientID, ClientSecret: c.ClientSecret, Audience: c.Server.Audience, Scope: "", TokenEndpointURL: c.Server.Issuer + "/token", TrustedCaFile: caFile}
	common.Transport.TCPMux = boolPtr(false)
	common.Transport.HeartbeatInterval = 10
	common.Transport.HeartbeatTimeout = 30
	common.Transport.DialServerTimeout = 5
	common.Transport.TLS.Enable = boolPtr(true)
	common.Transport.TLS.ServerName = c.Server.TLSName
	if err := common.Complete(); err != nil {
		return nil, nil, nil, err
	}
	common.Transport.ProxyURL = ""
	proxies := []v1.ProxyConfigurer{}
	visitors := []v1.VisitorConfigurer{}
	for _, p := range c.Peers {
		if c.Role == "host" {
			var b Binding
			for _, binding := range c.Bindings {
				if binding.MemberID == p.MemberID {
					b = binding
					break
				}
			}
			base := func(route string, port int) v1.ProxyBaseConfig {
				return v1.ProxyBaseConfig{Name: proxyName(p, route), Type: route, ProxyBackend: v1.ProxyBackend{LocalIP: "127.0.0.1", LocalPort: port}, Transport: v1.ProxyTransport{UseEncryption: true}}
			}
			proxies = append(proxies, &v1.STCPProxyConfig{ProxyBaseConfig: base("stcp", b.RelayPort), Secretkey: p.Secret, AllowUsers: []string{p.VisitorID}}, &v1.XTCPProxyConfig{ProxyBaseConfig: base("xtcp", b.P2PPort), Secretkey: p.Secret, AllowUsers: []string{p.VisitorID}})
		} else {
			relayName := "relay_" + p.MemberID
			base := func(name, route string, port int) v1.VisitorBaseConfig {
				return v1.VisitorBaseConfig{Name: name, Type: route, SecretKey: p.Secret, ServerUser: p.PublisherID, ServerName: proxyName(p, route), BindAddr: "127.0.0.1", BindPort: port, Transport: v1.VisitorTransport{UseEncryption: true}}
			}
			visitors = append(visitors, &v1.STCPVisitorConfig{VisitorBaseConfig: base(relayName, "stcp", -1)}, &v1.XTCPVisitorConfig{VisitorBaseConfig: base("game_"+p.MemberID, "xtcp", c.VisitorPort), KeepTunnelOpen: true, FallbackTo: relayName, FallbackTimeoutMs: 1200, MaxRetriesAnHour: 120, MinRetryInterval: 5})
		}
	}
	return common, proxies, visitors, nil
}

type Fence struct {
	MemberID  string
	SessionID string
	Revision  int
	Server    Server
	Secret    string
}

func (f *Fence) Accept(c Config) error {
	if f.MemberID != "" && (f.MemberID != c.MemberID || f.SessionID != c.SessionID || c.Revision < f.Revision || f.Server != c.Server || f.Secret != c.ClientSecret) {
		return errors.New("stale or changed membership")
	}
	f.MemberID = c.MemberID
	f.SessionID = c.SessionID
	f.Revision = c.Revision
	f.Server = c.Server
	f.Secret = c.ClientSecret
	return nil
}
func boolPtr(v bool) *bool { return &v }
