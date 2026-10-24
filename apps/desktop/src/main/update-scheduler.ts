export const UPDATE_INTERVAL = 60 * 60 * 1000;
interface Clock {
  now(): number;
  set(callback: () => void, delay: number): unknown;
  clear(timer: unknown): void;
}
const realClock: Clock = {
  now: Date.now,
  set: (callback, delay) => {
    const timer = setTimeout(callback, delay);
    timer.unref();
    return timer;
  },
  clear: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
};
export class UpdateScheduler {
  private timer?: unknown;
  private due = Infinity;
  private running = false;
  private stopped = true;
  constructor(
    private check: () => Promise<unknown>,
    private clock: Clock = realClock,
  ) {}
  start(delay = 20000) {
    this.stopped = false;
    this.due = this.clock.now() + delay;
    this.schedule();
  }
  private schedule() {
    if (this.timer !== undefined) this.clock.clear(this.timer);
    if (!this.stopped)
      this.timer = this.clock.set(
        () => void this.resume(),
        Math.max(0, this.due - this.clock.now()),
      );
  }
  async resume() {
    if (this.stopped || this.running || this.clock.now() < this.due) return;
    this.running = true;
    this.due = this.clock.now() + UPDATE_INTERVAL;
    try {
      await this.check();
    } catch {
      /* A failed check waits until the next hourly deadline. */
    } finally {
      this.running = false;
      this.schedule();
    }
  }
  checked() {
    this.due = this.clock.now() + UPDATE_INTERVAL;
    if (!this.stopped) this.schedule();
  }
  stop() {
    this.stopped = true;
    if (this.timer !== undefined) this.clock.clear(this.timer);
    this.timer = undefined;
  }
}

export async function automaticallyDownload(
  controller: import("./update-controller").UpdateController,
  enabled: boolean,
) {
  const status = controller.snapshot();
  if (enabled && status.mode === "install" && status.status === "available")
    await controller.download().catch(() => {});
}
