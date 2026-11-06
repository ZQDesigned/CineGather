import { createSocket, type Socket as UDP, type RemoteInfo } from "node:dgram";
import {
  createServer,
  createConnection,
  type Server,
  type Socket,
} from "node:net";
import { performance } from "node:perf_hooks";
import {
  GAME_LEASE_MS,
  gameLocalAddressSchema,
  gamePortSchema,
} from "@cinegather/contracts";
import type { GameProxyGrant } from "./game-proxy";

const UDP_MAGIC = Buffer.from("CGD1\n"),
  TCP_MAGIC = Buffer.from("CGT1\n");
const MAX_PACKET = 65507,
  MAX_QUEUE = 256 * 1024,
  MAX_PENDING = 64,
  MAX_SOURCES = 16;
export type GameDatagramEvent = {
  type: "datagram";
  code: string;
  bytesSent?: number;
  bytesReceived?: number;
  durationMs?: number;
  mappings?: number;
  queuedBytes?: number;
  dropped?: number;
  packetsSent?: number;
  packetsReceived?: number;
};
type Entry = {
  grant: GameProxyGrant;
  deadline: number;
  timer?: ReturnType<typeof setTimeout>;
  tcp?: Server;
  udp?: UDP;
  sockets: Set<Socket>;
  datagrams: Set<UDP>;
  pending: Map<Socket, number>;
  closed: boolean;
  udpBytes: number;
  udpPackets: number;
  sourceCount: number;
  sent: number;
  received: number;
  sentBytes: number;
  receivedBytes: number;
  sampleTimer?: ReturnType<typeof setInterval>;
};
function frame(type: number, data = Buffer.alloc(0)) {
  const head = Buffer.alloc(5);
  head[0] = type;
  head.writeUInt32BE(data.length, 1);
  return Buffer.concat([head, data]);
}
function localPort(address: string) {
  return Number(gameLocalAddressSchema.parse(address).split(":")[1]);
}
async function bindTCP(server: Server, port: number) {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  return (server.address() as { port: number }).port;
}
async function bindUDP(socket: UDP, port: number) {
  await new Promise<void>((resolve, reject) => {
    socket.once("error", reject);
    socket.bind(port, "127.0.0.1", () => {
      socket.off("error", reject);
      resolve();
    });
  });
  return socket.address().port;
}
function closeUDP(socket: UDP) {
  try {
    socket.close();
  } catch {
    /* Bind may not have completed. */
  }
}

/** Datagram boundaries are preserved over authenticated, encrypted FRP streams.
 * These are reliable streams: diagnostics must not describe them as loss-free UDP.
 */
export class GameDatagram {
  private entries = new Set<Entry>();
  private revoked = new Map<string, number>();
  private disposed = false;
  constructor(
    private options: { event?(event: GameDatagramEvent): void } = {},
  ) {}
  private emit(event: GameDatagramEvent) {
    try {
      this.options.event?.(event);
    } catch {
      /* diagnostic observer */
    }
  }
  private valid(e: Entry) {
    return (
      !this.disposed &&
      !e.closed &&
      performance.now() < e.deadline &&
      (this.revoked.get(e.grant.id) ?? 0) < e.grant.revision
    );
  }
  private make(grant: GameProxyGrant) {
    if (
      this.disposed ||
      !grant.id ||
      grant.id.length > 128 ||
      !Number.isInteger(grant.revision) ||
      grant.revision < 1 ||
      !Number.isFinite(grant.ttlMs) ||
      grant.ttlMs <= 0 ||
      grant.ttlMs > GAME_LEASE_MS ||
      (this.revoked.get(grant.id) ?? 0) >= grant.revision
    )
      throw Error("联机授权已失效");
    if (this.entries.size >= 16 || this.revoked.size >= 4096)
      throw Error("联机代理数量已达上限");
    const e: Entry = {
      grant: { ...grant },
      deadline: performance.now() + grant.ttlMs,
      sockets: new Set(),
      datagrams: new Set(),
      pending: new Map(),
      closed: false,
      udpBytes: 0,
      udpPackets: 0,
      sourceCount: 0,
      sent: 0,
      received: 0,
      sentBytes: 0,
      receivedBytes: 0,
    };
    this.entries.add(e);
    e.sampleTimer = setInterval(() => this.sample(e), 5000);
    e.sampleTimer.unref();
    this.arm(e);
    return e;
  }
  private sample(e: Entry) {
    this.emit({
      type: "datagram",
      code: "TRAFFIC_SAMPLE",
      packetsSent: e.sent,
      packetsReceived: e.received,
      bytesSent: e.sentBytes,
      bytesReceived: e.receivedBytes,
      mappings: e.datagrams.size + e.sourceCount,
      queuedBytes:
        e.udpBytes + [...e.sockets].reduce((n, s) => n + s.writableLength, 0),
    });
  }
  private traffic(e: Entry, sent: boolean, size: number) {
    if (sent) {
      e.sent++;
      e.sentBytes += size;
    } else {
      e.received++;
      e.receivedBytes += size;
    }
  }
  private arm(e: Entry) {
    clearTimeout(e.timer);
    e.timer = setTimeout(
      () => {
        this.emit({ type: "datagram", code: "LEASE_EXPIRED" });
        void this.closeEntry(e);
      },
      Math.max(1, e.deadline - performance.now()),
    );
    e.timer.unref();
  }
  private track(e: Entry, s: Socket) {
    e.sockets.add(s);
    s.on("error", (error) =>
      this.emit({
        type: "datagram",
        code:
          (error as NodeJS.ErrnoException).code
            ?.replace(/[^A-Z_0-9]/g, "")
            .slice(0, 64) || "SOCKET_ERROR",
      }),
    );
    s.on("close", () => {
      e.sockets.delete(s);
      e.pending.delete(s);
    });
    s.on("drain", () => e.pending.delete(s));
  }
  private write(e: Entry, s: Socket, data: Buffer) {
    const bytes = [...e.sockets].reduce(
        (n, socket) => n + socket.writableLength,
        0,
      ),
      pending = [...e.pending.values()].reduce((a, b) => a + b, 0);
    if (
      !this.valid(e) ||
      s.destroyed ||
      bytes + e.udpBytes + data.length > MAX_QUEUE ||
      pending + e.udpPackets >= MAX_PENDING
    ) {
      this.emit({
        type: "datagram",
        code: "QUEUE_LIMIT",
        dropped: 1,
        queuedBytes: bytes,
      });
      s.destroy();
      return false;
    }
    const ok = s.write(data);
    if (!ok || e.pending.has(s)) e.pending.set(s, (e.pending.get(s) ?? 0) + 1);
    return true;
  }
  private send(
    e: Entry,
    udp: UDP,
    packet: Buffer,
    port: number,
    address: string,
    stream: Socket,
  ) {
    const queued =
      e.udpBytes + [...e.sockets].reduce((n, s) => n + s.writableLength, 0);
    if (
      !this.valid(e) ||
      e.udpPackets + [...e.pending.values()].reduce((a, b) => a + b, 0) >=
        MAX_PENDING ||
      queued + packet.length > MAX_QUEUE
    ) {
      this.emit({
        type: "datagram",
        code: "QUEUE_LIMIT",
        dropped: 1,
        queuedBytes: queued,
      });
      stream.destroy();
      return;
    }
    e.udpPackets++;
    e.udpBytes += packet.length;
    const finished = (error?: Error | null) => {
      e.udpPackets--;
      e.udpBytes -= packet.length;
      if (error) {
        this.emit({
          type: "datagram",
          code:
            (error as NodeJS.ErrnoException).code
              ?.replace(/[^A-Z_0-9]/g, "")
              .slice(0, 64) || "SOCKET_ERROR",
        });
        stream.destroy();
      }
    };
    try {
      udp.send(packet, port, address, finished);
    } catch (error) {
      finished(error as Error);
    }
  }
  private parse(
    e: Entry,
    s: Socket,
    consume: (type: number, data: Buffer) => void,
  ) {
    let buffer = Buffer.alloc(0);
    s.on("data", (data: Buffer) => {
      if (!this.valid(e)) {
        s.destroy();
        return;
      }
      // Readable chunks are bounded too, before allocating a concatenation.
      if (buffer.length + data.length > 2 * (MAX_PACKET + 5)) {
        s.destroy();
        return;
      }
      buffer = Buffer.concat([buffer, data]);
      while (buffer.length >= 5) {
        const type = buffer[0]!,
          size = buffer.readUInt32BE(1);
        if (size > MAX_PACKET || type > 2 || (type !== 0 && size !== 0)) {
          this.emit({ type: "datagram", code: "INVALID_FRAME" });
          s.destroy();
          return;
        }
        if (buffer.length < size + 5) return;
        const packet = buffer.subarray(5, size + 5);
        buffer = buffer.subarray(size + 5);
        consume(type, packet);
        if (s.destroyed) return;
      }
    });
  }
  async createHost(grant: GameProxyGrant, targetPort: number): Promise<string> {
    gamePortSchema.parse(targetPort);
    const e = this.make(grant);
    e.tcp = createServer((s) => {
      if (!this.valid(e) || e.sockets.size >= MAX_SOURCES + 2) {
        s.destroy();
        return;
      }
      this.track(e, s);
      s.setNoDelay(true);
      s.setTimeout(5000, () => s.destroy());
      let first = Buffer.alloc(0);
      const handshake = (data: Buffer) => {
        first = Buffer.concat([first, data]);
        if (first.length < 5) return;
        s.off("data", handshake);
        s.setTimeout(0);
        const magic = first.subarray(0, 5),
          rest = first.subarray(5);
        if (magic.equals(TCP_MAGIC)) {
          const upstream = createConnection({
            host: "127.0.0.1",
            port: targetPort,
          });
          this.track(e, upstream);
          const timer = setTimeout(() => upstream.destroy(), 5000);
          timer.unref();
          upstream.once("connect", () => {
            clearTimeout(timer);
            if (!this.valid(e)) {
              s.destroy();
              upstream.destroy();
              return;
            }
            if (rest.length) upstream.write(rest);
            s.pipe(upstream);
            upstream.pipe(s);
            s.resume();
          });
          s.pause();
          s.on("close", () => upstream.destroy());
          upstream.on("close", () => {
            clearTimeout(timer);
            s.destroy();
          });
        } else if (magic.equals(UDP_MAGIC)) {
          let udp: UDP | undefined;
          let incoming = 0,
            outgoing = 0;
          const release = () => {
            if (udp) {
              e.datagrams.delete(udp);
              closeUDP(udp);
            }
            this.emit({
              type: "datagram",
              code: "CHANNEL_CLOSED",
              bytesSent: incoming,
              bytesReceived: outgoing,
              mappings: e.datagrams.size,
            });
          };
          s.once("close", release);
          this.parse(e, s, (type, packet) => {
            if (type === 1) {
              this.write(e, s, frame(2));
              return;
            }
            if (type !== 0) {
              s.destroy();
              return;
            }
            if (!udp) {
              if (e.datagrams.size >= MAX_SOURCES) {
                s.destroy();
                return;
              }
              udp = createSocket("udp4");
              e.datagrams.add(udp);
              udp.on("error", () => s.destroy());
              udp.on("message", (reply, remote) => {
                if (
                  remote.address !== "127.0.0.1" ||
                  remote.port !== targetPort ||
                  !this.valid(e)
                )
                  return;
                outgoing += reply.length;
                this.traffic(e, false, reply.length);
                this.write(e, s, frame(0, reply));
              });
              // Explicit loopback bind; response source is checked above.
              udp.bind(0, "127.0.0.1");
            }
            incoming += packet.length;
            this.traffic(e, true, packet.length);
            this.send(e, udp, packet, targetPort, "127.0.0.1", s);
          });
          s.setTimeout(120000, () => s.destroy());
          if (rest.length) s.emit("data", rest);
        } else {
          this.emit({ type: "datagram", code: "INVALID_PREAMBLE" });
          s.destroy();
        }
      };
      s.on("data", handshake);
    });
    e.tcp.on("error", () => void this.closeEntry(e));
    try {
      const port = await bindTCP(e.tcp, 0);
      if (!this.valid(e)) throw Error("联机授权已过期");
      return `127.0.0.1:${port}`;
    } catch (error) {
      await this.closeEntry(e);
      throw error;
    }
  }
  async createVisitor(
    grant: GameProxyGrant,
    target: string,
    listenPort = 24642,
  ): Promise<string> {
    const targetPort = localPort(target),
      e = this.make(grant),
      mappings = new Map<string, Socket>();
    if (!Number.isInteger(listenPort) || listenPort < 0 || listenPort > 65535) {
      await this.closeEntry(e);
      throw Error("本机端口无效");
    }
    e.udp = createSocket("udp4");
    const connect = (remote: RemoteInfo) => {
      const key = `${remote.address}:${remote.port}`;
      const previous = mappings.get(key);
      if (previous && !previous.destroyed) return previous;
      if (mappings.size >= MAX_SOURCES) return undefined;
      const s = createConnection({ host: "127.0.0.1", port: targetPort });
      s.setNoDelay(true);
      s.setTimeout(120000, () => s.destroy());
      this.track(e, s);
      mappings.set(key, s);
      e.sourceCount = mappings.size;
      s.on("close", () => {
        if (mappings.get(key) === s) mappings.delete(key);
        e.sourceCount = mappings.size;
      });
      this.write(e, s, UDP_MAGIC);
      this.parse(e, s, (type, packet) => {
        if (type !== 0) {
          s.destroy();
          return;
        }
        if (this.valid(e) && e.udp) {
          this.traffic(e, false, packet.length);
          this.send(e, e.udp, packet, remote.port, remote.address, s);
        }
      });
      return s;
    };
    e.udp.on("message", (packet, remote) => {
      if (!this.valid(e) || remote.address !== "127.0.0.1") return;
      const s = connect(remote);
      this.traffic(e, true, packet.length);
      if (s) this.write(e, s, frame(0, packet));
      else
        this.emit({
          type: "datagram",
          code: "MAPPING_LIMIT",
          dropped: 1,
          mappings: mappings.size,
        });
    });
    e.udp.on("error", () => void this.closeEntry(e));
    e.tcp = createServer((s) => {
      if (!this.valid(e) || e.sockets.size >= 2 * MAX_SOURCES) {
        s.destroy();
        return;
      }
      const upstream = createConnection({
        host: "127.0.0.1",
        port: targetPort,
      });
      this.track(e, s);
      this.track(e, upstream);
      this.write(e, upstream, TCP_MAGIC);
      s.pipe(upstream);
      upstream.pipe(s);
      s.on("close", () => upstream.destroy());
      upstream.on("close", () => s.destroy());
    });
    e.tcp.on("error", () => void this.closeEntry(e));
    try {
      const port = await bindUDP(e.udp, listenPort);
      await bindTCP(e.tcp, port);
      if (!this.valid(e)) throw Error("联机授权已过期");
      return `127.0.0.1:${port}`;
    } catch {
      await this.closeEntry(e);
      throw Error("本机游戏端口已被占用或不可用，请关闭冲突的服务后重试");
    }
  }
  probe(address: string) {
    const port = localPort(address),
      started = performance.now();
    return new Promise<void>((resolve, reject) => {
      const s = createConnection({ host: "127.0.0.1", port }),
        // FRP fallback and verified TLS/OIDC setup can consume more than 2.5s
        // on a high-latency first connection. Keep a bounded startup budget.
        timer = setTimeout(() => finish(Error("游戏通道连接超时")), 5000);
      let done = false,
        buffer = Buffer.alloc(0);
      const finish = (error?: Error) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        s.destroy();
        this.emit({
          type: "datagram",
          code: error ? "PROBE_FAILED" : "PROBE_READY",
          durationMs: Math.round(performance.now() - started),
        });
        if (error) reject(error);
        else resolve();
      };
      s.on("error", () => finish(Error("游戏通道尚未就绪")));
      s.on("close", () => finish(Error("游戏通道已关闭")));
      s.once("connect", () => s.write(Buffer.concat([UDP_MAGIC, frame(1)])));
      s.on("data", (data) => {
        buffer = Buffer.concat([buffer, data]);
        if (
          buffer.length > 5 ||
          (buffer.length === 5 && !buffer.equals(frame(2)))
        )
          finish(Error("游戏通道响应无效"));
        else if (buffer.length === 5) finish();
      });
    });
  }
  renew(id: string, revision: number, ttlMs: number) {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0 || ttlMs > GAME_LEASE_MS)
      return false;
    let found = false;
    for (const e of this.entries)
      if (e.grant.id === id && e.grant.revision === revision && this.valid(e)) {
        e.deadline = performance.now() + ttlMs;
        this.arm(e);
        found = true;
      }
    return found;
  }
  async revoke(id: string) {
    const entries = [...this.entries].filter((e) => e.grant.id === id);
    this.revoked.set(
      id,
      Math.max(
        this.revoked.get(id) ?? 0,
        ...entries.map((e) => e.grant.revision),
        1,
      ),
    );
    await Promise.all(entries.map((e) => this.closeEntry(e)));
  }
  private async closeEntry(e: Entry) {
    if (e.closed) return;
    e.closed = true;
    clearTimeout(e.timer);
    clearInterval(e.sampleTimer);
    this.sample(e);
    this.entries.delete(e);
    for (const s of e.sockets) s.destroy();
    for (const s of e.datagrams) closeUDP(s);
    if (e.udp) closeUDP(e.udp);
    await new Promise<void>((resolve) => {
      if (e.tcp?.listening) e.tcp.close(() => resolve());
      else resolve();
    });
  }
  async close() {
    this.disposed = true;
    await Promise.all([...this.entries].map((e) => this.closeEntry(e)));
  }
}
