export class MobileTimers {
  private next = 0;
  private callbacks = new Map<number, { fn(): void; repeat: boolean }>();
  constructor(
    private readonly native: {
      schedule(id: number, delay: number, repeat: boolean): void;
      cancel(id: number): void;
    },
  ) {}
  private add(fn: () => void, delay: number, repeat: boolean) {
    const id = ++this.next;
    this.callbacks.set(id, { fn, repeat });
    try {
      this.native.schedule(
        id,
        Math.max(1, Math.min(2147483647, Number.isFinite(delay) ? delay : 1)),
        repeat,
      );
    } catch (error) {
      this.callbacks.delete(id);
      throw error;
    }
    return id;
  }
  timeout(fn: () => void, delay = 0) {
    return this.add(fn, delay, false);
  }
  interval(fn: () => void, delay = 0) {
    return this.add(fn, delay, true);
  }
  clear(id: number) {
    if (this.callbacks.delete(id)) this.native.cancel(id);
  }
  fire(id: number) {
    const value = this.callbacks.get(id);
    if (!value) return;
    if (!value.repeat) this.callbacks.delete(id);
    value.fn();
  }
  dispose() {
    for (const id of this.callbacks.keys()) this.clear(id);
  }
}
