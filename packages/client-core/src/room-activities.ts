import type {
  ActivityCommand,
  ActivitySnapshot,
  BoardElement,
} from "@cinegather/contracts";
export interface ActivityPatch {
  type: "patch";
  baseRevision: number;
  snapshot: ActivitySnapshot;
  board?: {
    revision: number;
    canUndo: boolean;
    canRedo: boolean;
    put: BoardElement[];
    remove: string[];
  };
}
export function applyActivityPatch(
  current: ActivitySnapshot,
  patch: ActivityPatch,
): ActivitySnapshot | undefined {
  if (
    current.roomId !== patch.snapshot.roomId ||
    current.generation !== patch.snapshot.generation ||
    current.revision !== patch.baseRevision
  )
    return;
  const elements = new Map(current.board?.elements.map((e) => [e.id, e]) ?? []);
  for (const id of patch.board?.remove ?? []) elements.delete(id);
  for (const element of patch.board?.put ?? [])
    elements.set(element.id, element);
  return {
    ...patch.snapshot,
    ...(patch.board
      ? {
          board: {
            revision: patch.board.revision,
            canUndo: patch.board.canUndo,
            canRedo: patch.board.canRedo,
            elements: [...elements.values()],
          },
        }
      : {}),
  };
}
export interface RoomActivityClientState {
  snapshot?: ActivitySnapshot;
  status: "idle" | "connecting" | "connected" | "reconnecting" | "failed";
  error?: string;
}
export class RoomActivityClient {
  private value: RoomActivityClientState = { status: "idle" };
  private listeners = new Set<() => void>();
  private socket?: WebSocket;
  private roomId?: string;
  private epoch = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private attempt = 0;
  private serial = 0;
  private pending = new Map<
    string,
    {
      resolve: () => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  constructor(
    private readonly deps: {
      origin(): string;
      ticket(roomId: string): Promise<{ ticket: string }>;
      socket?(url: string): WebSocket;
      failure?(error: unknown): void;
    },
  ) {}
  getSnapshot = () => this.value;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private set(value: RoomActivityClientState) {
    this.value = value;
    for (const listener of this.listeners) listener();
  }
  connect(roomId: string) {
    if (this.roomId === roomId && this.value.status !== "failed") return;
    this.disconnect();
    this.roomId = roomId;
    void this.open(this.epoch);
  }
  disconnect() {
    this.epoch++;
    this.roomId = undefined;
    clearTimeout(this.timer);
    this.socket?.close();
    this.socket = undefined;
    this.attempt = 0;
    this.rejectPending();
    this.set({ status: "idle" });
  }
  private rejectPending() {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(Error("连接已变化，请确认房间状态后重试"));
    }
    this.pending.clear();
  }
  private async open(epoch: number) {
    if (epoch !== this.epoch || !this.roomId) return;
    this.set({
      ...this.value,
      status: this.value.snapshot ? "reconnecting" : "connecting",
      error: undefined,
    });
    try {
      const { ticket } = await this.deps.ticket(this.roomId);
      if (epoch !== this.epoch) return;
      const url = new URL("/api/v1/room-activities/ws", this.deps.origin());
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      const ws =
        this.deps.socket?.(url.toString()) ?? new WebSocket(url.toString());
      this.socket = ws;
      ws.onopen = () => {
        if (epoch === this.epoch) ws.send(JSON.stringify({ ticket }));
      };
      ws.onmessage = (event) => {
        if (epoch !== this.epoch || this.socket !== ws) return;
        try {
          const message = JSON.parse(String(event.data));
          if (message.type === "snapshot") {
            if (message.snapshot.roomId !== this.roomId)
              throw Error("Room mismatch");
            this.attempt = 0;
            this.set({ status: "connected", snapshot: message.snapshot });
          } else if (message.type === "patch") {
            const next =
              this.value.snapshot &&
              applyActivityPatch(this.value.snapshot, message);
            if (!next) {
              ws.close();
              return;
            }
            this.set({ status: "connected", snapshot: next });
          } else if (message.type === "ack" || message.type === "error") {
            const pending = this.pending.get(message.id);
            if (!pending) return;
            this.pending.delete(message.id);
            clearTimeout(pending.timer);
            if (message.type === "ack") pending.resolve();
            else pending.reject(Error(message.message ?? "操作未完成"));
          }
        } catch {
          ws.close();
        }
      };
      ws.onclose = () => {
        if (epoch !== this.epoch || this.socket !== ws) return;
        this.socket = undefined;
        this.rejectPending();
        this.schedule(epoch);
      };
      ws.onerror = () => ws.close();
    } catch (error) {
      if (epoch !== this.epoch) return;
      const status = (error as { status?: number }).status;
      if (
        status !== undefined &&
        status >= 400 &&
        status < 500 &&
        status !== 408 &&
        status !== 429
      ) {
        this.set({
          status: "failed",
          error: error instanceof Error ? error.message : "活动不可用",
        });
        if (status === 426) this.deps.failure?.(error);
        return;
      }
      this.schedule(epoch);
    }
  }
  private schedule(epoch: number) {
    if (epoch !== this.epoch) return;
    this.set({
      ...this.value,
      status: "reconnecting",
      error: "正在重新连接房间活动",
    });
    this.timer = setTimeout(
      () => void this.open(epoch),
      Math.min(15000, 1000 * 2 ** this.attempt++),
    );
  }
  assertContext(expected: Pick<ActivitySnapshot, "roomId" | "generation">) {
    const current = this.value.snapshot;
    if (
      !current ||
      current.roomId !== expected.roomId ||
      current.generation !== expected.generation
    )
      throw Error("房间活动已变化，请重新选择");
  }
  command(
    command: ActivityCommand,
    expected?: Pick<ActivitySnapshot, "roomId" | "generation">,
  ): Promise<void> {
    if (expected) {
      try {
        this.assertContext(expected);
      } catch (e) {
        return Promise.reject(e);
      }
    }
    if (this.value.status !== "connected" || this.socket?.readyState !== 1)
      return Promise.reject(Error("请等待房间活动连接恢复"));
    if (this.pending.size >= 8)
      return Promise.reject(Error("操作过快，请稍后重试"));
    const id = `activity-${Date.now()}-${++this.serial}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Error("操作确认超时，请先检查当前状态"));
        this.socket?.close();
      }, 10000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket!.send(JSON.stringify({ id, command }));
    });
  }
}
