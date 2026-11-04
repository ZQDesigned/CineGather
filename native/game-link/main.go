package main

import (
	"bufio"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"os/signal"
	"strconv"
	"sync"
	"syscall"
	"time"

	"github.com/fatedier/frp/client"
	"github.com/fatedier/frp/pkg/config/source"
	v1 "github.com/fatedier/frp/pkg/config/v1"
	frplog "github.com/fatedier/frp/pkg/util/log"
	liblog "github.com/fatedier/golib/log"
)

func itoa(n int) string { return strconv.Itoa(n) }

type Connector struct {
	ctx   context.Context
	cfg   *v1.ClientCommonConfig
	roots *x509.CertPool
	emit  func(any)
}

func (c *Connector) Open() error  { return nil }
func (c *Connector) Close() error { return nil }
func (c *Connector) Connect() (net.Conn, error) {
	c.emit(map[string]any{"event": "transport", "phase": "tls_dial", "state": "connecting"})
	d := tls.Dialer{NetDialer: &net.Dialer{Timeout: 5 * time.Second, KeepAlive: 15 * time.Second}, Config: &tls.Config{ServerName: c.cfg.Transport.TLS.ServerName, RootCAs: c.roots, MinVersion: tls.VersionTLS12}}
	started := time.Now()
	conn, err := d.DialContext(c.ctx, "tcp", net.JoinHostPort(c.cfg.ServerAddr, itoa(c.cfg.ServerPort)))
	if err != nil {
		c.emit(map[string]any{"event": "transport", "phase": "tls_dial", "state": "failed", "code": networkCode(err), "durationMs": time.Since(started).Milliseconds()})
		return nil, err
	}
	c.emit(map[string]any{"event": "transport", "phase": "tls_dial", "state": "connected", "durationMs": time.Since(started).Milliseconds()})
	return conn, nil
}
func networkCode(err error) string {
	var e *net.OpError
	if errors.As(err, &e) {
		if e.Timeout() {
			return "ETIMEDOUT"
		}
		var errno syscall.Errno
		if errors.As(err, &errno) {
			switch errno {
			case syscall.ECONNREFUSED:
				return "ECONNREFUSED"
			case syscall.ECONNRESET:
				return "ECONNRESET"
			case syscall.ENETUNREACH:
				return "ENETUNREACH"
			case syscall.EHOSTUNREACH:
				return "EHOSTUNREACH"
			}
		}
	}
	var certErr *tls.CertificateVerificationError
	if errors.As(err, &certErr) {
		return "TLS_CERTIFICATE"
	}
	return "NETWORK_ERROR"
}

type Runtime struct {
	mu          sync.Mutex
	service     *client.Service
	cancel      context.CancelFunc
	deadline    *time.Timer
	fence       Fence
	closed      bool
	leaseEpoch  uint64
	development bool
	caFile      string
	roots       *x509.CertPool
	emit        func(any)
}

func (r *Runtime) Configure(c Config) error {
	common, proxies, visitors, err := buildConfig(c, r.development, r.caFile)
	if err != nil {
		return err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed {
		return errors.New("authorization ended")
	}
	if err = r.fence.Accept(c); err != nil {
		return err
	}
	if r.deadline != nil {
		r.deadline.Stop()
	}
	r.leaseEpoch++
	epoch := r.leaseEpoch
	r.deadline = time.AfterFunc(time.Until(c.ExpiresAt), func() { r.expire(epoch) })
	if r.service != nil {
		return r.service.UpdateConfigSource(common, proxies, visitors)
	}
	src := source.NewConfigSource()
	if err = src.ReplaceAll(proxies, visitors); err != nil {
		return err
	}
	service, err := client.NewService(client.ServiceOptions{Common: common, ConfigSourceAggregator: source.NewAggregator(src), ConnectorCreator: func(ctx context.Context, cfg *v1.ClientCommonConfig) client.Connector {
		return &Connector{ctx: ctx, cfg: cfg, roots: r.roots, emit: r.emit}
	}})
	if err != nil {
		return err
	}
	ctx, cancel := context.WithCancel(context.Background())
	r.cancel = cancel
	r.service = service
	go func() {
		if err := service.Run(ctx); err != nil {
			r.emit(map[string]any{"event": "transport", "state": "failed", "phase": "control", "code": "CONTROL_FAILED"})
		}
	}()
	return nil
}
func (r *Runtime) expire(epoch uint64) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed || r.leaseEpoch != epoch {
		return
	}
	r.stopLocked()
	r.emit(map[string]any{"event": "transport", "state": "expired", "phase": "lease", "code": "AUTH_EXPIRED"})
}
func (r *Runtime) Stop() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.stopLocked()
}
func (r *Runtime) stopLocked() {
	if r.closed {
		return
	}
	r.closed = true
	if r.deadline != nil {
		r.deadline.Stop()
	}
	if r.cancel != nil {
		r.cancel()
	}
	if r.service != nil {
		r.service.Close()
		r.service = nil
	}
}

type Command struct {
	ID      string          `json:"id"`
	Version int             `json:"version"`
	Op      string          `json:"op"`
	Config  json.RawMessage `json:"config,omitempty"`
}

func run(input io.Reader, output io.Writer, development bool, caFile string) int {
	var outputMu sync.Mutex
	emit := func(value any) { outputMu.Lock(); defer outputMu.Unlock(); _ = json.NewEncoder(output).Encode(value) }
	roots, err := x509.SystemCertPool()
	if err != nil {
		roots = x509.NewCertPool()
	}
	if caFile != "" {
		if !development {
			return 2
		}
		pem, err := os.ReadFile(caFile)
		if err != nil || !roots.AppendCertsFromPEM(pem) {
			return 2
		}
	}
	r := Runtime{development: development, caFile: caFile, roots: roots, emit: emit}
	defer r.Stop()
	scanner := bufio.NewScanner(input)
	scanner.Buffer(make([]byte, 4096), 65536)
	for scanner.Scan() {
		if len(scanner.Bytes()) == 0 {
			continue
		}
		var c Command
		if decodeConfig(scanner.Bytes(), &c) != nil || len(c.ID) == 0 || len(c.ID) > 64 || c.Version != 1 {
			emit(map[string]any{"event": "transport", "state": "failed", "code": "PROTOCOL_INVALID"})
			return 2
		}
		reply := map[string]any{"id": c.ID, "ok": true}
		switch c.Op {
		case "configure":
			var cfg Config
			if decodeConfig(c.Config, &cfg) != nil || r.Configure(cfg) != nil {
				reply["ok"] = false
				reply["code"] = "CONFIG_REJECTED"
			} else {
				reply["result"] = map[string]any{"state": "configured"}
			}
		case "stop":
			r.Stop()
			reply["result"] = map[string]any{"state": "stopped"}
			emit(reply)
			return 0
		default:
			reply["ok"] = false
			reply["code"] = "COMMAND_UNKNOWN"
		}
		emit(reply)
	}
	if scanner.Err() != nil {
		emit(map[string]any{"event": "transport", "state": "failed", "code": "PROTOCOL_OVERSIZED"})
		return 2
	}
	return 0
}
func main() {
	frplog.Logger = frplog.Logger.WithOptions(liblog.WithOutput(io.Discard))
	if len(os.Args) > 1 {
		fmt.Fprintln(os.Stderr, "No command-line configuration is supported")
		os.Exit(2)
	}
	signalCh := make(chan os.Signal, 1)
	signal.Notify(signalCh, os.Interrupt, syscall.SIGTERM)
	go func() { <-signalCh; _ = os.Stdin.Close() }()
	os.Exit(run(os.Stdin, os.Stdout, os.Getenv("CG_GAME_DEVELOPMENT") == "1", os.Getenv("CG_GAME_DEVELOPMENT_CA")))
}
