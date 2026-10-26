import type { ChatMessage } from "@cinegather/contracts";
export interface ChatSnapshot {
  roomId?: string;
  items: ChatMessage[];
  unread: number;
  loading: boolean;
  failed: boolean;
}
export class RoomChat {
  private generation = 0;
  private roomId?: string;
  private userId?: string;
  private items = new Map<string, ChatMessage>();
  private seen = new Set<string>();
  private unread = new Set<string>();
  private visible = false;
  private bottom = true;
  private initialized = false;
  private cursor?: string;
  private loading = false;
  private failed = false;
  private work?: Promise<void>;
  constructor(
    private readonly load: (
      roomId: string,
      after?: string,
    ) => Promise<{ items: ChatMessage[]; nextCursor: string | null }>,
    private readonly changed: (state: ChatSnapshot) => void,
    private readonly notify: (message: ChatMessage, unread: number) => void,
  ) {}
  snapshot(): ChatSnapshot {
    return {
      roomId: this.roomId,
      items: [...this.items.values()].sort((a, b) =>
        a.createdAt === b.createdAt
          ? a.id < b.id
            ? -1
            : a.id === b.id
              ? 0
              : 1
          : a.createdAt < b.createdAt
            ? -1
            : 1,
      ),
      unread: this.unread.size,
      loading: this.loading,
      failed: this.failed,
    };
  }
  private emit() {
    this.changed(this.snapshot());
  }
  async enter(roomId: string, userId: string) {
    this.leave();
    this.roomId = roomId;
    this.userId = userId;
    this.emit();
    await this.sync();
  }
  leave() {
    ++this.generation;
    this.roomId = undefined;
    this.userId = undefined;
    this.items.clear();
    this.seen.clear();
    this.unread.clear();
    this.visible = false;
    this.bottom = true;
    this.initialized = false;
    this.cursor = undefined;
    this.work = undefined;
    this.loading = false;
    this.failed = false;
    this.emit();
  }
  setView(visible: boolean, bottom: boolean) {
    this.visible = visible;
    this.bottom = bottom;
    if (visible && bottom) this.markRead();
  }
  markRead() {
    if (!this.unread.size) return;
    this.unread.clear();
    this.emit();
  }
  private merge(messages: ChatMessage[], live: boolean) {
    const received: ChatMessage[] = [];
    for (const message of messages) {
      const fresh = !this.seen.has(message.id);
      this.seen.add(message.id);
      this.items.set(message.id, message);
      if (
        fresh &&
        live &&
        message.userId !== this.userId &&
        !(this.visible && this.bottom)
      ) {
        this.unread.add(message.id);
        received.push(message);
      }
    }
    // Keep a bounded rendered history and a larger duplicate window.
    const sorted = this.snapshot().items;
    for (const old of sorted.slice(0, -500)) this.items.delete(old.id);
    while (this.seen.size > 5000)
      this.seen.delete(this.seen.values().next().value!);
    this.emit();
    if (!this.visible && received.length)
      this.notify(received.at(-1)!, this.unread.size);
  }
  receive(roomId: string, message: ChatMessage) {
    if (roomId === this.roomId) this.merge([message], true);
  }
  sync(): Promise<void> {
    if (this.work) return this.work;
    const roomId = this.roomId,
      generation = this.generation;
    if (!roomId) return Promise.resolve();
    const current = () =>
      this.roomId === roomId && this.generation === generation;
    const work = (async () => {
      this.loading = !this.initialized;
      this.emit();
      try {
        for (let pages = 0; current(); pages++) {
          const after = this.cursor;
          const page = await this.load(roomId, after);
          if (!current()) return;
          this.failed = false;
          this.merge(page.items, this.initialized);
          this.initialized = true;
          if (page.items.length) this.cursor = page.items.at(-1)!.id;
          else this.cursor ??= "start";
          // A push never advances cursor: late/out-of-order events cannot hide gaps.
          if (!after || !page.nextCursor) break;
          if (pages >= 19) break; // Continue any unusually large backlog at the next sync.
        }
      } catch {
        if (current()) this.failed = true;
      } finally {
        if (current()) {
          this.loading = false;
          this.emit();
        }
      }
    })();
    this.work = work;
    void work
      .finally(() => {
        if (this.work === work) this.work = undefined;
      })
      .catch(() => {});
    return work;
  }
}
