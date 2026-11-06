import type {
  ActivityCommand,
  ActivitySnapshot,
  BoardElement,
  BoardPresence,
  BoardPresenceInput,
} from "@cinegather/contracts";
export interface ActivityPatch {
  type: "patch";
  baseRevision: number;
  snapshot: ActivitySnapshot;
  board?: {
    revision: number;
    canUndo: boolean;
    canRedo: boolean;
    canEdit: boolean;
    editorIds: string[];
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
            canEdit: patch.board.canEdit,
            editorIds: patch.board.editorIds,
            elements: [...elements.values()],
          },
        }
      : {}),
  };
}
export interface RoomActivityClientState {
  snapshot?: ActivitySnapshot;
  presence?: BoardPresence[];
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
  private presenceTimer?: ReturnType<typeof setTimeout>;
  private presenceExpiry?: ReturnType<typeof setInterval>;
  private lastPresenceAt = 0;
  private outgoingPresence?: BoardPresenceInput;
  private peerExpiry = new Map<string, number>();
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
    this.presenceExpiry = setInterval(() => {
      const presence = (this.value.presence ?? []).filter(
        (p) => (this.peerExpiry.get(p.userId) ?? 0) > Date.now(),
      );
      if (
        presence.length !== this.value.presence?.length &&
        this.value.presence?.length
      )
        this.set({ ...this.value, presence });
    }, 1000);
    void this.open(this.epoch);
  }
  disconnect() {
    this.epoch++;
    this.roomId = undefined;
    clearTimeout(this.timer);
    clearTimeout(this.presenceTimer);
    clearInterval(this.presenceExpiry);
    this.presenceTimer = undefined;
    this.outgoingPresence = undefined;
    this.peerExpiry.clear();
    this.lastPresenceAt = 0;
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
            this.acceptSnapshot(message.snapshot);
          } else if (message.type === "patch") {
            const next =
              this.value.snapshot &&
              applyActivityPatch(this.value.snapshot, message);
            if (!next) {
              ws.close();
              return;
            }
            this.acceptSnapshot(next);
          } else if (message.type === "presence") {
            const peer = message.presence as BoardPresence & { left?: boolean };
            const snapshot = this.value.snapshot;
            if (
              !snapshot ||
              peer.roomId !== snapshot.roomId ||
              peer.generation !== snapshot.generation
            )
              return;
            this.peerExpiry.set(peer.userId, Date.now() + 5000);
            const presence = (this.value.presence ?? []).filter(
              (p) => p.userId !== peer.userId,
            );
            if (!peer.left && (peer.cursor || peer.draft)) presence.push(peer);
            this.set({
              ...this.value,
              presence: this.filterPresence(snapshot, presence),
            });
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
      presence: [],
    });
    this.timer = setTimeout(
      () => void this.open(epoch),
      Math.min(15000, 1000 * 2 ** this.attempt++),
    );
  }
  private filterPresence(
    snapshot: ActivitySnapshot,
    presence: BoardPresence[],
  ) {
    return presence
      .filter(
        (p) =>
          p.roomId === snapshot.roomId && p.generation === snapshot.generation,
      )
      .map((p) => {
        const current =
          p.draft &&
          snapshot.board?.elements.find((e) => e.id === p.draft!.element.id);
        const editable =
          snapshot.board?.editorIds?.includes(p.userId) &&
          (snapshot.kind === "board" || snapshot.game?.phase === "playing");
        const validDraft =
          editable &&
          p.draft &&
          (current
            ? current.version === p.draft.expectedVersion
            : p.draft.expectedVersion === undefined);
        return validDraft ? p : { ...p, draft: null };
      });
  }
  private acceptSnapshot(snapshot: ActivitySnapshot) {
    this.set({
      status: "connected",
      snapshot,
      presence: this.filterPresence(snapshot, this.value.presence ?? []),
    });
  }
  sendPresence(
    frame: Omit<BoardPresenceInput, "generation">,
    expected: Pick<ActivitySnapshot, "roomId" | "generation">,
  ) {
    if (
      this.value.status !== "connected" ||
      this.socket?.readyState !== 1 ||
      this.value.snapshot?.roomId !== expected.roomId ||
      this.value.snapshot?.generation !== expected.generation
    )
      return;
    this.outgoingPresence = { ...frame, generation: expected.generation };
    if (this.presenceTimer) return;
    const flush = () => {
      this.presenceTimer = undefined;
      const next = this.outgoingPresence;
      this.outgoingPresence = undefined;
      if (
        !next ||
        this.value.status !== "connected" ||
        this.socket?.readyState !== 1 ||
        this.socket.bufferedAmount > 128_000 ||
        this.value.snapshot?.generation !== next.generation
      )
        return;
      this.lastPresenceAt = Date.now();
      this.socket.send(JSON.stringify({ type: "presence", presence: next }));
    };
    const delay = Math.max(0, 50 - (Date.now() - this.lastPresenceAt));
    if (!delay) flush();
    else this.presenceTimer = setTimeout(flush, delay);
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
