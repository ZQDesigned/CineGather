import type { ServerWebSocket } from "bun";
// Loopback-only companion for isolated development. Production uses nginx's
// auth_request before forwarding the same signalling routes.
type Peer = {
  target: string;
  upstream?: WebSocket;
  queue: (string | Buffer)[];
  closed: boolean;
};
export function startEsportsDevGateway(options: {
  port: number;
  apiUrl: string;
  upstreamUrl: string;
  secret: string;
}) {
  return Bun.serve<Peer>({
    hostname: "127.0.0.1",
    port: options.port,
    async fetch(req, server) {
      const url = new URL(req.url);
      if (
        !["/rtc", "/rtc/validate", "/rtc/v1", "/rtc/v1/validate"].includes(
          url.pathname,
        )
      )
        return new Response(null, { status: 404 });
      const token =
        url.searchParams.get("access_token") ??
        req.headers.get("Authorization")?.replace(/^Bearer /, "");
      if (!token) return new Response(null, { status: 401 });
      let status = 503;
      try {
        const r = await fetch(
          options.apiUrl + "/api/v1/internal/esports-admission",
          {
            headers: {
              Authorization: "Bearer " + token,
              "X-CineGather-Admission": options.secret,
            },
            signal: AbortSignal.timeout(7000),
          },
        );
        status = r.status;
      } catch {
        /* Fail closed. */
      }
      if (status !== 204)
        return new Response(null, {
          status:
            status === 401 ? 401 : status === 403 || status === 409 ? 403 : 503,
        });
      const target = new URL(url.pathname + url.search, options.upstreamUrl);
      if (req.headers.get("upgrade")?.toLowerCase() !== "websocket")
        return fetch(target, {
          headers: { Authorization: "Bearer " + token },
          signal: AbortSignal.timeout(7000),
        });
      if (
        server.upgrade(req, {
          data: {
            queue: [],
            closed: false,
            target: target.toString().replace(/^http/, "ws"),
          },
        })
      )
        return;
      return new Response(null, { status: 400 });
    },
    websocket: {
      open(ws: ServerWebSocket<Peer>) {
        const data = ws.data;
        if (!data.target) {
          ws.close(1011);
          return;
        }
        const peer = new WebSocket(data.target);
        data.upstream = peer;
        peer.binaryType = "arraybuffer";
        peer.onopen = () => {
          if (data.closed) {
            peer.close();
            return;
          }
          for (const msg of data.queue) peer.send(msg);
          data.queue = [];
        };
        peer.onmessage = (event) => {
          if (!data.closed) ws.send(event.data);
        };
        peer.onclose = () => {
          data.closed = true;
          ws.close();
        };
        peer.onerror = () => {
          data.closed = true;
          ws.close(1011);
        };
      },
      message(ws, message) {
        const d = ws.data;
        if (d.upstream?.readyState === WebSocket.OPEN) d.upstream.send(message);
        else if (d.queue.length < 64) d.queue.push(message);
        else ws.close(1009);
      },
      close(ws) {
        ws.data.closed = true;
        ws.data.upstream?.close();
        ws.data.queue = [];
      },
    },
  });
}
