import { createHash } from "node:crypto";
import { createServer } from "node:net";
import {
  gameTunnelConfigSchema,
  type GameTunnelConfig,
  type GameLocalStatus,
} from "@cinegather/contracts";
import {
  GameNative,
  type GameNativeEvent,
  type NativeGameConfig,
} from "./game-native";
import { GameProxy, type GameProxyEvent } from "./game-proxy";
import {
  probeMinecraftWorld,
  discoverMinecraftWorlds,
} from "./minecraft-worlds";
export interface GameConnectionObservation {
  sessionId: string;
  memberId: string;
  revision: number;
  route: "p2p" | "relay";
}
const port = (address: string) =>
  Number(address.slice(address.lastIndexOf(":") + 1));
async function unusedPort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw Error("无法准备本机联机端口");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}
export class GameLocal {
  private epoch = 0;
  private queue = Promise.resolve();
  private config?: GameTunnelConfig;
  private proxy?: GameProxy;
  private native?: GameNative;
  private hostPort?: number;
  private visitorPort?: number;
  private address?: string;
  private discovery?: AbortController;
  private work?: AbortController;
  private peerRevisions = new Map<string, number>();
  private bindings = new Map<string, NativeGameConfig["bindings"][number]>();
  status: GameLocalStatus = { state: "idle" };
  constructor(
    private options: {
      binaryPath: string;
      development?: boolean;
      caFile?: string;
      event?(event: GameNativeEvent | GameProxyEvent): void;
      connection?(event: GameConnectionObservation): void;
    },
  ) {}
  diagnosticContext() {
    return {
      state: this.status.state,
      ...(this.config
        ? {
            role: this.config.role,
            revision: this.config.revision,
            sessionHash: createHash("sha256")
              .update(this.config.sessionId)
              .digest("hex"),
            leaseRemainingMs: Math.min(
              30000,
              Math.max(0, Date.parse(this.config.expiresAt) - Date.now()),
            ),
          }
        : {}),
    };
  }
  discover() {
    this.discovery?.abort();
    const controller = new AbortController();
    this.discovery = controller;
    return discoverMinecraftWorlds({ signal: controller.signal });
  }
  probe(port: number) {
    return probeMinecraftWorld(port);
  }
  private valid(epoch: number) {
    if (epoch !== this.epoch) throw Error("游戏联机操作已取消");
  }
  configure(raw: GameTunnelConfig, worldPort?: number) {
    const config = gameTunnelConfigSchema.parse(raw),
      epoch = this.epoch;
    const result = this.queue
      .catch(() => {})
      .then(() => this.apply(config, worldPort, epoch))
      .catch(async (error) => {
        if (epoch === this.epoch)
          await this.fail(epoch, "游戏联机连接未完成，请重试");
        throw error;
      });
    this.queue = result.then(
      () => {},
      () => {},
    );
    return result;
  }
  private async apply(
    config: GameTunnelConfig,
    worldPort: number | undefined,
    epoch: number,
  ): Promise<GameLocalStatus> {
    this.valid(epoch);
    if (
      this.config &&
      (this.config.memberId !== config.memberId ||
        this.config.revision !== config.revision ||
        this.config.sessionId !== config.sessionId)
    )
      throw Error("请先关闭旧的联机连接");
    const ttl = Math.min(30000, Date.parse(config.expiresAt) - Date.now());
    if (ttl <= 0) throw Error("游戏联机授权已过期");
    if (!this.proxy) {
      this.proxy = new GameProxy({
        event: (event) => {
          this.options.event?.(event);
          if (epoch !== this.epoch) return;
          const peer = this.config?.peers.find(
            (p) =>
              p.memberId === event.grantId && p.revision === event.revision,
          );
          if (
            event.type === "connected" &&
            event.route &&
            peer &&
            this.config?.role === "host"
          )
            this.options.connection?.({
              sessionId: this.config.sessionId,
              memberId: peer.memberId,
              revision: peer.revision,
              route: event.route,
            });
          if (event.type === "expired" && this.config?.role === "guest")
            void this.fail(epoch, "联机授权已过期，请重新连接");
        },
      });
      this.native = new GameNative({
        ...this.options,
        event: (event) => {
          this.options.event?.(event);
          if (epoch !== this.epoch) return;
          if (
            (event.event === "transport" && event.state === "expired") ||
            (event.event === "process" && event.state === "exited")
          )
            void this.fail(epoch, "游戏联机连接已中断，请重新连接");
        },
      });
    }
    this.config = config;
    this.status = {
      ...this.status,
      state: this.address || this.hostPort ? this.status.state : "connecting",
      message: undefined,
    };
    this.work?.abort();
    this.work = new AbortController();
    const signal = this.work.signal;
    if (config.role === "host") {
      if (!this.hostPort) {
        if (!worldPort) throw Error("请先选择本机世界");
        await probeMinecraftWorld(worldPort, { signal });
        this.valid(epoch);
        this.hostPort = worldPort;
      }
      if (worldPort && worldPort !== this.hostPort)
        throw Error("结束当前联机后才可切换本机世界");
      const expected = new Set(config.peers.map((p) => p.memberId));
      for (const id of this.bindings.keys())
        if (!expected.has(id)) {
          await this.proxy.revoke(id);
          this.bindings.delete(id);
          this.valid(epoch);
        }
      for (const peer of config.peers) {
        const peerTTL = Math.min(ttl, Date.parse(peer.expiresAt) - Date.now());
        if (peerTTL <= 0) {
          if (this.bindings.has(peer.memberId))
            await this.proxy.revoke(peer.memberId);
          this.bindings.delete(peer.memberId);
          continue;
        }
        const grant = {
            id: peer.memberId,
            revision: peer.revision,
            ttlMs: peerTTL,
          },
          target = { host: "127.0.0.1" as const, port: this.hostPort };
        if (
          this.bindings.has(peer.memberId) &&
          this.peerRevisions.get(peer.memberId) !== peer.revision
        ) {
          await this.proxy.revoke(peer.memberId);
          this.bindings.delete(peer.memberId);
        }
        if (this.bindings.has(peer.memberId)) {
          if (!this.proxy.renew(peer.memberId, peer.revision, peerTTL))
            throw Error("好友的联机授权已过期，请让对方重新加入");
          continue;
        }
        const p2p = await this.proxy.createHostGateway({
          grant,
          target,
          route: "p2p",
        });
        this.valid(epoch);
        const relay = await this.proxy.createHostGateway({
          grant,
          target,
          route: "relay",
        });
        this.valid(epoch);
        this.peerRevisions.set(peer.memberId, peer.revision);
        this.bindings.set(peer.memberId, {
          memberId: peer.memberId,
          p2pPort: port(p2p.address),
          relayPort: port(relay.address),
        });
      }
      await this.native!.configure(config, [...this.bindings.values()]);
      this.valid(epoch);
      this.status = { state: "connected" };
    } else {
      if (!this.visitorPort) {
        this.visitorPort = await unusedPort();
        this.valid(epoch);
      }
      await this.native!.configure(config, [], this.visitorPort);
      this.valid(epoch);
      const visitorTTL = Math.min(
        30000,
        Date.parse(config.expiresAt) - Date.now(),
      );
      if (visitorTTL <= 0) throw Error("游戏联机授权已过期");
      if (!this.address) {
        const visitor = await this.proxy.createVisitor({
          grant: {
            id: config.memberId,
            revision: config.revision,
            ttlMs: visitorTTL,
          },
          target: { host: "127.0.0.1", port: this.visitorPort },
        });
        this.valid(epoch);
        this.address = visitor.address;
      } else if (
        !this.proxy.renew(config.memberId, config.revision, visitorTTL)
      )
        throw Error("游戏联机授权已过期，请重新连接");
      if (this.status.state !== "connected") {
        let reachable = false;
        for (let attempt = 0; attempt < 3 && !reachable; attempt++) {
          try {
            await probeMinecraftWorld(port(this.address), {
              signal,
              timeoutMs: 2500,
            });
            reachable = true;
          } catch {
            this.valid(epoch);
            if (signal.aborted) throw Error("操作已取消");
          }
        }
        this.valid(epoch);
        this.status = {
          state: reachable ? "connected" : "connecting",
          address: this.address,
          ...(!reachable
            ? { message: "正在等待世界连接就绪，请稍后重试" }
            : {}),
        };
      } else this.status = { state: "connected", address: this.address };
    }
    return { ...this.status };
  }
  private async fail(epoch: number, message: string) {
    if (epoch !== this.epoch) return;
    await this.stop();
    this.status = { state: "failed", message };
  }
  async stop() {
    this.epoch++;
    this.discovery?.abort();
    this.work?.abort();
    const proxy = this.proxy,
      native = this.native;
    this.config = undefined;
    this.proxy = undefined;
    this.native = undefined;
    this.hostPort = undefined;
    this.visitorPort = undefined;
    this.address = undefined;
    this.bindings = new Map();
    this.peerRevisions = new Map();
    this.status = { state: "idle" };
    await Promise.all([proxy?.close(), native?.close()]);
  }
}
