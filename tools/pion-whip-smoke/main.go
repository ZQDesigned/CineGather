package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"sync"
	"sync/atomic"
	"time"

	"github.com/pion/dtls/v3/pkg/crypto/elliptic"
	"github.com/pion/ice/v4"
	"github.com/pion/webrtc/v4"
)

type traceConn struct {
	net.PacketConn
	mu      sync.Mutex
	packets []map[string]any
}

func (c *traceConn) record(direction string, b []byte) {
	if len(b) < 13 || b[0] < 20 || b[0] > 25 {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	for len(b) >= 13 {
		size := int(b[11])<<8 | int(b[12])
		if len(b) < 13+size {
			return
		}
		row := map[string]any{"direction": direction, "contentType": b[0], "epoch": int(b[3])<<8 | int(b[4]), "size": size}
		if b[0] == 22 && b[3] == 0 && b[4] == 0 && size >= 12 {
			row["handshakeType"] = b[13]
			row["sequence"] = int(b[17])<<8 | int(b[18])
			row["fragmentOffset"] = int(b[19])<<16 | int(b[20])<<8 | int(b[21])
		}
		if len(c.packets) < 128 {
			c.packets = append(c.packets, row)
		}
		b = b[13+size:]
	}
}
func (c *traceConn) ReadFrom(b []byte) (int, net.Addr, error) {
	n, a, e := c.PacketConn.ReadFrom(b)
	if e == nil {
		c.record("received", b[:n])
	}
	return n, a, e
}
func (c *traceConn) WriteTo(b []byte, a net.Addr) (int, error) {
	c.record("sent", b)
	return c.PacketConn.WriteTo(b, a)
}

// Match LiveKit ingress' Pion version, curves and handshake retransmission.
// This fixture records counters only, and never persists SDP or media.
func main() {
	var mu sync.Mutex
	var peers []*webrtc.PeerConnection
	var frames atomic.Uint64
	var packets atomic.Uint64
	var state atomic.Value
	var iceState atomic.Value
	state.Store("new")
	iceState.Store("new")
	var se webrtc.SettingEngine
	udp, err := net.ListenPacket("udp4", "0.0.0.0:0")
	if err != nil {
		os.Exit(1)
	}
	trace := &traceConn{PacketConn: udp}
	se.SetICEUDPMux(ice.NewUDPMuxDefault(ice.UDPMuxParams{UDPConn: trace}))
	se.SetIncludeLoopbackCandidate(true)
	se.SetDTLSEllipticCurves(elliptic.X25519, elliptic.P384, elliptic.P256)
	se.SetDTLSRetransmissionInterval(100 * time.Millisecond)
	api := webrtc.NewAPI(webrtc.WithSettingEngine(se))
	mux := http.NewServeMux()
	mux.HandleFunc("/stats", func(w http.ResponseWriter, r *http.Request) {
		trace.mu.Lock()
		headers := append([]map[string]any(nil), trace.packets...)
		trace.mu.Unlock()
		json.NewEncoder(w).Encode(map[string]any{"frames": frames.Load(), "packets": packets.Load(), "state": state.Load(), "iceState": iceState.Load(), "dtlsHeaders": headers})
	})
	mux.HandleFunc("/whip", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "DELETE" {
			mu.Lock()
			for _, p := range peers {
				p.Close()
			}
			peers = nil
			mu.Unlock()
			w.WriteHeader(200)
			return
		}
		if r.Method != "POST" {
			w.WriteHeader(405)
			return
		}
		body, err := io.ReadAll(io.LimitReader(r.Body, 65536))
		if err != nil {
			w.WriteHeader(400)
			return
		}
		pc, err := api.NewPeerConnection(webrtc.Configuration{})
		if err != nil {
			w.WriteHeader(500)
			return
		}
		mu.Lock()
		peers = append(peers, pc)
		mu.Unlock()
		pc.OnConnectionStateChange(func(s webrtc.PeerConnectionState) { state.Store(s.String()) })
		pc.OnICEConnectionStateChange(func(s webrtc.ICEConnectionState) { iceState.Store(s.String()) })
		pc.OnTrack(func(track *webrtc.TrackRemote, _ *webrtc.RTPReceiver) {
			var last uint32
			first := true
			for {
				packet, _, err := track.ReadRTP()
				if err != nil {
					return
				}
				packets.Add(1)
				if track.Kind() == webrtc.RTPCodecTypeVideo && (first || last != packet.Timestamp) {
					frames.Add(1)
					last = packet.Timestamp
					first = false
				}
			}
		})
		for _, kind := range []webrtc.RTPCodecType{webrtc.RTPCodecTypeVideo, webrtc.RTPCodecTypeAudio} {
			if _, err = pc.AddTransceiverFromKind(kind, webrtc.RTPTransceiverInit{Direction: webrtc.RTPTransceiverDirectionRecvonly}); err != nil {
				w.WriteHeader(500)
				return
			}
		}
		if err = pc.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeOffer, SDP: string(body)}); err != nil {
			w.WriteHeader(400)
			return
		}
		answer, err := pc.CreateAnswer(nil)
		if err != nil {
			w.WriteHeader(500)
			return
		}
		gathered := webrtc.GatheringCompletePromise(pc)
		if err = pc.SetLocalDescription(answer); err != nil {
			w.WriteHeader(500)
			return
		}
		select {
		case <-gathered:
		case <-time.After(5 * time.Second):
			w.WriteHeader(504)
			return
		}
		w.Header().Set("Content-Type", "application/sdp")
		w.Header().Set("Location", "/whip")
		w.WriteHeader(201)
		io.WriteString(w, pc.LocalDescription().SDP)
	})
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		os.Exit(1)
	}
	fmt.Printf("{\"port\":%d}\n", listener.Addr().(*net.TCPAddr).Port)
	http.Serve(listener, mux)
}
