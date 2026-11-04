import { emptyFeaturePolicy, type FeaturePolicy } from "@cinegather/contracts";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { SignalResponse } from "@livekit/protocol";
import type { Server, IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { RequestHandler } from "express";
import { admitMediaToken } from "./esports-admission";
const rejectedStatus = (error: unknown) => {
  const status = (error as { getStatus?: () => number })?.getStatus?.();
  return status === 401
    ? 401
    : status === 403 || status === 404 || status === 409
      ? 403
      : 503;
};
const rtcPath = (path: string) =>
  ["/rtc", "/rtc/validate", "/rtc/v1", "/rtc/v1/validate"].includes(path);
const authToken = (req: IncomingMessage, url: URL) =>
  url.searchParams.get("access_token") ??
  req.headers.authorization?.replace(/^Bearer /, "");
function bytes(data: RawData) {
  return Array.isArray(data)
    ? Buffer.concat(data)
    : data instanceof ArrayBuffer
      ? Buffer.from(data)
      : data;
}
export function attachEsportsGateway(
  server: Server,
  upstreamUrl: string,
  maintenance: () => boolean = () => false,
  featurePolicy: () => FeaturePolicy = () => emptyFeaturePolicy,
) {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 1024 * 1024,
    perMessageDeflate: false,
  });
  const upstreams = new Set<WebSocket>();
  let pending = 0;
  const upgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!rtcPath(url.pathname)) {
      socket.destroy();
      return;
    }
    const token = authToken(req, url);
    const deny = (status: number) => {
      if (!socket.destroyed)
        socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\n\r\n`);
    };
    if (!token) {
      deny(401);
      return;
    }
    if (maintenance()) {
      deny(503);
      return;
    }
    if (pending >= 80 || wss.clients.size >= 1000) {
      deny(503);
      return;
    }
    pending++;
    let client: WebSocket | undefined, upstream: WebSocket | undefined;
    // Authorize under the parent row's shared lock and keep it until the SFU has
    // registered the participant. A concurrent revocation then removes that exact
    // session before issuing new rights, instead of racing a pending upgrade.
    void admitMediaToken(
      token,
      () =>
        new Promise<void>((resolve, reject) => {
          const target = new URL(url.pathname + url.search, upstreamUrl);
          target.protocol = target.protocol === "https:" ? "wss:" : "ws:";
          let joined = false,
            settled = false;
          const timer = setTimeout(
            () => finish(new Error("SFU admission timed out")),
            7000,
          );
          const finish = (error?: Error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (error) reject(error);
            else resolve();
          };
          const close = () => {
            if (!joined) finish(new Error("SFU admission closed"));
            client?.terminate();
            upstream?.terminate();
          };
          wss.handleUpgrade(req, socket, head, (downstream) => {
            client = downstream;
            upstream = new WebSocket(target, {
              headers: { Authorization: "Bearer " + token },
              maxPayload: 1024 * 1024,
              perMessageDeflate: false,
              handshakeTimeout: 7000,
            });
            upstreams.add(upstream);
            const queue: { data: RawData; binary: boolean }[] = [];
            downstream.on("message", (data, binary) => {
              if (upstream?.readyState === WebSocket.OPEN)
                upstream.send(data, { binary });
              else if (queue.length < 64) queue.push({ data, binary });
              else close();
            });
            upstream.on("open", () => {
              for (const message of queue)
                upstream!.send(message.data, { binary: message.binary });
              queue.length = 0;
            });
            upstream.on("message", (data, binary) => {
              if (!joined) {
                try {
                  const message = binary
                    ? SignalResponse.fromBinary(bytes(data)).message
                    : SignalResponse.fromJsonString(bytes(data).toString())
                        .message;
                  if (message.case === "join" || message.case === "reconnect") {
                    joined = true;
                    finish();
                  } else if (message.case === "leave") {
                    close();
                    return;
                  }
                } catch {
                  close();
                  return;
                }
              }
              if (downstream.readyState === WebSocket.OPEN) {
                if (downstream.bufferedAmount > 2 * 1024 * 1024) {
                  close();
                  return;
                }
                downstream.send(data, { binary });
              }
            });
            downstream.on("close", () => {
              if (!joined) finish(new Error("Client admission closed"));
              if (upstream?.readyState === WebSocket.OPEN) upstream.close();
              else if (upstream?.readyState === WebSocket.CONNECTING)
                upstream.terminate();
            });
            downstream.on("error", close);
            upstream.on("close", (code, reason) => {
              upstreams.delete(upstream!);
              if (!joined) finish(new Error("SFU admission closed"));
              // Flush the SFU's final Leave message before closing, preserving
              // kick/device-takeover reasons in the client notification.
              if (downstream.readyState === WebSocket.OPEN) {
                const safeCode =
                  code === 1005 ? 1000 : code === 1006 ? 1011 : code;
                try {
                  downstream.close(safeCode, reason);
                } catch {
                  downstream.terminate();
                }
              }
            });
            upstream.on("error", close);
          });
        }),
      featurePolicy,
    )
      .catch((error) => {
        client?.terminate();
        upstream?.terminate();
        deny(rejectedStatus(error));
      })
      .finally(() => {
        pending--;
      });
  };
  server.on("upgrade", upgrade);
  const middleware: RequestHandler = async (req, res, next) => {
    const url = new URL(req.originalUrl, "http://localhost");
    if (!rtcPath(url.pathname)) {
      next();
      return;
    }
    if (maintenance()) {
      res.status(503).end();
      return;
    }
    const token = authToken(req, url);
    if (!token) {
      res.status(401).end();
      return;
    }
    try {
      await admitMediaToken(token, undefined, featurePolicy);
      const response = await fetch(
        new URL(url.pathname + url.search, upstreamUrl),
        {
          headers: { Authorization: "Bearer " + token },
          signal: AbortSignal.timeout(7000),
        },
      );
      res
        .status(response.status)
        .type(response.headers.get("Content-Type") ?? "text/plain")
        .send(await response.text());
    } catch (error) {
      res.status(rejectedStatus(error)).end();
    }
  };
  return {
    middleware,
    close() {
      server.off("upgrade", upgrade);
      for (const client of wss.clients) client.terminate();
      for (const peer of upstreams) peer.terminate();
      wss.close();
    },
  };
}
