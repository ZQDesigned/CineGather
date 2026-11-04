import {
  createServer,
  createConnection,
  type Server,
  type Socket,
} from "node:net";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { GAME_LEASE_MS } from "@cinegather/contracts";

export interface GameProxyTarget {
  host: "127.0.0.1";
  port: number;
}
export interface GameProxyGrant {
  id: string;
  revision: number;
  ttlMs: number;
}
export interface GameProxyListener {
  id: string;
  address: string;
}
export interface GameProxyEvent {
  type: "connected" | "closed" | "failed" | "expired";
  grantId: string;
  revision: number;
  route?: "p2p" | "relay";
  bytesSent?: number;
  bytesReceived?: number;
  code?: string;
}
interface Connection {
  client: Socket;
  upstream: Socket;
}
interface Listener {
  id: string;
  grant: GameProxyGrant;
  target: GameProxyTarget;
  route?: "p2p" | "relay";
  deadline: number;
  server: Server;
  ready: Promise<void>;
  connections: Set<Connection>;
  timer?: ReturnType<typeof setTimeout>;
  closed: boolean;
  closing?: Promise<void>;
}

// These are real loopback TCP gateways, not display aliases for public endpoints.
// A member's sockets remain controllable even when FRP already established P2P.
export class GameProxy {
  private listeners = new Map<string, Listener>();
  private revoked = new Map<string, number>();
  private disposed = false;
  constructor(
    private options: {
      event?(event: GameProxyEvent): void;
      now?: () => number;
    } = {},
  ) {}
  private now() {
    return this.options.now?.() ?? performance.now();
  }
  private target(value: GameProxyTarget) {
    if (
      value.host !== "127.0.0.1" ||
      !Number.isInteger(value.port) ||
      value.port < 1 ||
      value.port > 65535
    )
      throw Error("联机代理只允许连接本机服务");
    return { ...value };
  }
  private grant(value: GameProxyGrant) {
    if (
      !value.id ||
      value.id.length > 128 ||
      !Number.isInteger(value.revision) ||
      value.revision < 1 ||
      !Number.isFinite(value.ttlMs) ||
      value.ttlMs <= 0 ||
      value.ttlMs > GAME_LEASE_MS
    )
      throw Error("联机授权无效");
    if (this.disposed || (this.revoked.get(value.id) ?? 0) >= value.revision)
      throw Error("联机授权已失效");
    return { ...value };
  }
  private emit(
    entry: Listener,
    event: Omit<GameProxyEvent, "grantId" | "revision" | "route">,
  ) {
    try {
      this.options.event?.({
        ...event,
        grantId: entry.grant.id,
        revision: entry.grant.revision,
        ...(entry.route ? { route: entry.route } : {}),
      });
    } catch {
      /* Observability must not prevent socket cleanup. */
    }
  }
  private valid(entry: Listener) {
    return (
      !this.disposed &&
      !entry.closed &&
      this.now() < entry.deadline &&
      (this.revoked.get(entry.grant.id) ?? 0) < entry.grant.revision
    );
  }
  private arm(entry: Listener) {
    clearTimeout(entry.timer);
    entry.timer = setTimeout(
      () => {
        this.emit(entry, { type: "expired" });
        void this.revoke(entry.grant.id);
      },
      Math.max(1, entry.deadline - this.now()),
    );
    entry.timer.unref();
  }
  private accept(entry: Listener, client: Socket) {
    let count = 0;
    for (const listener of this.listeners.values())
      if (listener.grant.id === entry.grant.id)
        count += listener.connections.size;
    if (!this.valid(entry) || count >= 16) {
      client.destroy();
      return;
    }
    const target = entry.target;
    const upstream = createConnection({ host: target.host, port: target.port });
    const connection = { client, upstream };
    entry.connections.add(connection);
    let sent = 0,
      received = 0,
      ended = false;
    const timeout = setTimeout(() => fail("CONNECT_TIMEOUT"), 5000);
    timeout.unref();
    const close = () => {
      if (ended) return;
      ended = true;
      clearTimeout(timeout);
      client.destroy();
      upstream.destroy();
      entry.connections.delete(connection);
      this.emit(entry, {
        type: "closed",
        bytesSent: sent,
        bytesReceived: received,
      });
    };
    const fail = (code: string) => {
      if (ended) return;
      this.emit(entry, { type: "failed", code });
      close();
    };
    client.on("error", () => fail("CLIENT_CLOSED"));
    upstream.on("error", () => fail("TARGET_UNAVAILABLE"));
    client.on("close", close);
    upstream.on("close", close);
    upstream.once("connect", () => {
      clearTimeout(timeout);
      if (!this.valid(entry)) {
        close();
        return;
      }
      client.setKeepAlive(true, 30000);
      upstream.setKeepAlive(true, 30000);
      this.emit(entry, { type: "connected" });
      client.on("data", (data: Buffer) => {
        sent += data.length;
      });
      upstream.on("data", (data: Buffer) => {
        received += data.length;
      });
      client.pipe(upstream);
      upstream.pipe(client);
    });
  }
  createVisitor(input: { grant: GameProxyGrant; target: GameProxyTarget }) {
    return this.create(input);
  }
  createHostGateway(input: {
    grant: GameProxyGrant;
    target: GameProxyTarget;
    route: "p2p" | "relay";
  }) {
    return this.create(input);
  }
  private async create(input: {
    grant: GameProxyGrant;
    target: GameProxyTarget;
    route?: "p2p" | "relay";
  }): Promise<GameProxyListener> {
    const grant = this.grant(input.grant),
      target = this.target(input.target);
    if (this.listeners.size >= 32 || this.revoked.size >= 4096)
      throw Error("联机代理数量已达上限");
    for (const active of this.listeners.values())
      if (
        active.grant.id === grant.id &&
        active.grant.revision !== grant.revision
      )
        throw Error("请先结束旧的联机连接");
    const server = createServer(),
      id = randomUUID();
    const entry: Listener = {
      id,
      grant,
      target,
      route: input.route,
      server,
      deadline: this.now() + grant.ttlMs,
      connections: new Set(),
      ready: Promise.resolve(),
      closed: false,
    };
    server.on("connection", (socket) => this.accept(entry, socket));
    server.on("error", () => {
      this.emit(entry, { type: "failed", code: "LISTENER_UNAVAILABLE" });
      void this.closeEntry(entry);
    });
    this.listeners.set(id, entry);
    entry.ready = new Promise<void>((resolve, reject) => {
      const failed = () => reject(Error("无法开启本机联机代理"));
      server.once("error", failed);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", failed);
        resolve();
      });
    });
    try {
      await entry.ready;
      if (!this.valid(entry)) throw Error("联机授权已失效");
      const address = server.address();
      if (
        !address ||
        typeof address === "string" ||
        address.address !== "127.0.0.1"
      )
        throw Error("本机联机代理地址无效");
      this.arm(entry);
      return { id, address: `127.0.0.1:${address.port}` };
    } catch (error) {
      await this.closeEntry(entry);
      throw error;
    }
  }
  updateRoute(id: string, target: GameProxyTarget) {
    const entry = this.listeners.get(id);
    if (!entry || !this.valid(entry)) throw Error("联机代理已关闭");
    entry.target = this.target(target);
  }
  renew(grantId: string, revision: number, ttlMs: number) {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0 || ttlMs > GAME_LEASE_MS)
      return false;
    const entries = [...this.listeners.values()].filter(
      (v) => v.grant.id === grantId,
    );
    if (
      !entries.length ||
      entries.some((v) => v.grant.revision !== revision || !this.valid(v))
    )
      return false;
    for (const entry of entries) {
      entry.deadline = this.now() + ttlMs;
      this.arm(entry);
    }
    return true;
  }
  private closeEntry(entry: Listener) {
    if (entry.closing) return entry.closing;
    entry.closed = true;
    this.listeners.delete(entry.id);
    clearTimeout(entry.timer);
    for (const { client, upstream } of entry.connections) {
      client.destroy();
      upstream.destroy();
    }
    entry.closing = (async () => {
      await entry.ready.catch(() => {});
      await new Promise<void>((resolve) => entry.server.close(() => resolve()));
    })();
    return entry.closing;
  }
  async revoke(grantId: string) {
    const entries = [...this.listeners.values()].filter(
      (v) => v.grant.id === grantId,
    );
    const revision = Math.max(
      this.revoked.get(grantId) ?? 0,
      ...entries.map((v) => v.grant.revision),
    );
    this.revoked.set(grantId, revision || 1);
    await Promise.all(entries.map((entry) => this.closeEntry(entry)));
  }
  async close() {
    this.disposed = true;
    await Promise.all(
      [...this.listeners.values()].map((entry) => this.closeEntry(entry)),
    );
    this.revoked.clear();
  }
}
