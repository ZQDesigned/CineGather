import {
  GAME_RENEW_MS,
  type GameSnapshot,
  type GameTunnelConfig,
  type GameWorld,
  type GameLocalStatus,
  type GameKind,
} from "@cinegather/contracts";
export interface GameLinkState {
  snapshot: GameSnapshot;
  local: GameLocalStatus;
  syncing: boolean;
  error?: string;
}
export interface GameLinkAPI {
  snapshot(): Promise<GameSnapshot>;
  create(input: {
    game: GameKind;
    name: string;
    gameVersion?: string;
  }): Promise<GameSnapshot>;
  ready(id: string): Promise<GameSnapshot>;
  renew(id: string, revision: number): Promise<GameSnapshot>;
  transport(id: string): Promise<GameTunnelConfig>;
  leave(id: string): Promise<GameSnapshot>;
}
export interface GameLinkLocal {
  probe(port: number, game?: GameKind): Promise<GameWorld>;
  configure(
    input: GameTunnelConfig,
    worldPort?: number,
  ): Promise<GameLocalStatus>;
  stop(): Promise<void>;
  status?(): Promise<GameLocalStatus>;
}
const empty = (): GameSnapshot => ({
  session: null,
  self: null,
  members: [],
  requests: [],
  invitations: [],
});
/** Deliberately has no room/media/voice dependency. A login scope fences every await. */
export class GameLinkCoordinator {
  state: GameLinkState = {
    snapshot: empty(),
    local: { state: "idle" },
    syncing: false,
  };
  private epoch = 0;
  private identity?: string;
  private hostPort?: number;
  private activeMember?: string;
  private activeRevision?: number;
  private renewedAt = 0;
  private queue = Promise.resolve();
  private refreshPending?: Promise<void>;
  private exitPending?: Promise<void>;
  constructor(
    private options: {
      api: GameLinkAPI;
      local?: GameLinkLocal;
      changed(state: GameLinkState): void;
      failure?(error: unknown): void;
      now?: () => number;
    },
  ) {}
  private publish(patch: Partial<GameLinkState>) {
    this.state = { ...this.state, ...patch };
    this.options.changed(this.state);
  }
  async scope(identity: string | undefined) {
    if (identity === this.identity) return;
    this.epoch++;
    this.exitPending = undefined;
    this.identity = identity;
    this.hostPort = undefined;
    this.activeMember = undefined;
    this.renewedAt = 0;
    this.publish({
      snapshot: empty(),
      local: { state: "idle" },
      syncing: false,
      error: undefined,
    });
    await this.options.local?.stop();
  }
  private current(epoch: number) {
    return epoch === this.epoch && !!this.identity;
  }
  private serialize(action: (epoch: number) => Promise<void>) {
    const epoch = this.epoch;
    const next = this.queue
      .catch(() => {})
      .then(async () => {
        if (!this.current(epoch)) return;
        this.publish({ syncing: true });
        try {
          await action(epoch);
        } finally {
          if (this.current(epoch)) this.publish({ syncing: false });
        }
      });
    this.queue = next.catch(() => {});
    return next;
  }
  private async connect(snapshot: GameSnapshot, epoch: number) {
    if (!this.current(epoch)) return;
    this.publish({ snapshot });
    const { session, self } = snapshot,
      local = this.options.local;
    if (!session || !self) {
      if (this.activeMember) {
        this.activeMember = undefined;
        await local?.stop();
      }
      if (this.current(epoch))
        this.publish({ local: { state: "idle" }, error: undefined });
      return;
    }
    if (!local) {
      this.publish({
        local: {
          state: "idle",
          message: "请在 Windows 或 macOS 桌面客户端进行游戏联机",
        },
      });
      return;
    }
    if (self.role === "host" && !this.hostPort) {
      if (this.state.local.reason === "world-unavailable") return;
      this.publish({
        local: {
          state: "idle",
          message: "请选择本机世界以恢复联机，或结束此次联机",
        },
      });
      return;
    }
    if (this.activeMember && this.activeMember !== self.memberId) {
      await local.stop();
      if (!this.current(epoch)) return;
    }
    const now = this.options.now?.() ?? Date.now();
    if (!this.renewedAt || now - this.renewedAt >= GAME_RENEW_MS) {
      snapshot = await this.options.api.renew(session.id, self.revision);
      if (!this.current(epoch)) return;
      this.renewedAt = now;
      this.publish({ snapshot });
    }
    if (self.role === "host" && session.status === "recovering") {
      snapshot = await this.options.api.ready(session.id);
      if (!this.current(epoch)) return;
      this.publish({ snapshot });
    }
    const config = await this.options.api.transport(session.id);
    if (!this.current(epoch)) return;
    if (
      this.activeRevision !== undefined &&
      this.activeRevision !== config.revision
    ) {
      await local.stop();
      if (!this.current(epoch)) return;
    }
    const status = await local.configure(
      config,
      self.role === "host" ? this.hostPort : undefined,
    );
    if (!this.current(epoch)) return;
    this.activeMember = self.memberId;
    this.activeRevision = config.revision;
    const own = snapshot.members.find((m) => m.id === config.memberId);
    this.publish({
      local: { ...status, ...(own?.route ? { route: own.route } : {}) },
      error: undefined,
    });
    if (self.role === "host" && snapshot.session?.status === "starting") {
      const ready = await this.options.api.ready(session.id);
      if (this.current(epoch)) this.publish({ snapshot: ready });
    }
  }
  refresh() {
    if (this.exitPending) return this.exitPending;
    if (this.refreshPending) return this.refreshPending;
    const pending = this.serialize(async (epoch) => {
      try {
        await this.connect(await this.options.api.snapshot(), epoch);
      } catch (error) {
        if (!this.current(epoch)) return;
        const status =
          error && typeof error === "object" && "status" in error
            ? error.status
            : undefined;
        if ([401, 403, 404, 426].includes(status as number)) {
          this.activeMember = undefined;
          await this.options.local?.stop();
        }
        if (!this.current(epoch)) return;
        const local = await this.options.local
          ?.status?.()
          .catch(() => undefined);
        if (!this.current(epoch)) return;
        if (local?.reason === "world-unavailable") {
          this.hostPort = undefined;
          this.activeMember = undefined;
          this.activeRevision = undefined;
          this.renewedAt = 0;
        }
        this.publish({
          error:
            local?.reason === "world-unavailable"
              ? local.message
              : "暂时无法同步游戏联机，请稍后重试",
          ...(local ? { local } : {}),
        });
        this.options.failure?.(error);
      }
    });
    this.refreshPending = pending;
    const clear = () => {
      if (this.refreshPending === pending) this.refreshPending = undefined;
    };
    void pending.then(clear, clear);
    return pending;
  }
  create(name: string, port: number, game: GameKind = "minecraft-java") {
    return this.serialize(async (epoch) => {
      const world = await this.options.local?.probe(port, game);
      if (!world) throw Error("请使用映聚桌面客户端发起联机");
      if (!this.current(epoch)) return;
      const snapshot = await this.options.api.create({
        game,
        name,
        ...(world.version ? { gameVersion: world.version } : {}),
      });
      if (!this.current(epoch)) return;
      this.hostPort = port;
      this.renewedAt = 0;
      try {
        await this.connect(snapshot, epoch);
      } catch (error) {
        if (!this.current(epoch)) return;
        const local = await this.options.local
          ?.status?.()
          .catch(() => undefined);
        if (!this.current(epoch)) return;
        this.publish({
          local: local ?? { state: "failed" },
          error: "联机已创建，但本机连接未就绪，请重新连接",
        });
        this.options.failure?.(error);
      }
    });
  }
  resumeHost(port: number) {
    return this.serialize(async (epoch) => {
      await this.options.local?.probe(port, this.state.snapshot.session?.game);
      if (!this.current(epoch)) return;
      await this.options.local?.stop();
      if (!this.current(epoch)) return;
      this.activeMember = undefined;
      this.activeRevision = undefined;
      this.hostPort = port;
      this.renewedAt = 0;
      await this.connect(await this.options.api.snapshot(), epoch);
    });
  }
  exit() {
    if (this.exitPending) return this.exitPending;
    const pending = this.leaveCurrent();
    this.exitPending = pending;
    const clear = () => {
      if (this.exitPending === pending) this.exitPending = undefined;
    };
    void pending.then(clear, clear);
    return pending;
  }
  private async leaveCurrent() {
    const snapshot = this.state.snapshot;
    this.epoch++;
    this.activeMember = undefined;
    this.activeRevision = undefined;
    this.hostPort = undefined;
    this.renewedAt = 0;
    const epoch = this.epoch;
    this.publish({ syncing: true });
    try {
      await this.options.local?.stop();
      if (!this.current(epoch)) return;
      if (snapshot.session && snapshot.self)
        await this.options.api.leave(snapshot.session.id);
      if (this.current(epoch))
        this.publish({
          snapshot: empty(),
          local: { state: "idle" },
          error: undefined,
        });
    } finally {
      if (this.current(epoch)) this.publish({ syncing: false });
    }
  }
}
