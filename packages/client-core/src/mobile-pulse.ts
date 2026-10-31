interface PulseClock {
  now(): number;
  set(fn: () => void, delay: number): unknown;
  clear(handle: unknown): void;
}
const clock: PulseClock = {
  now: Date.now,
  set: (fn, delay) => setTimeout(fn, delay),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};
// UI-bound RN timers can pause in the background. Native audio service ticks
// enter the same scheduler, with one in-flight sample and one fallback timer.
export class MobilePulse {
  private active = false;
  private running = false;
  private last = -Infinity;
  private timer: unknown;
  constructor(
    private readonly deps: {
      clock?: PulseClock;
      interval(): number;
      run(): Promise<void>;
      error(error: unknown): void;
    },
  ) {}
  private get clock() {
    return this.deps.clock ?? clock;
  }
  start() {
    if (this.active) return;
    this.active = true;
    this.pulse();
  }
  stop() {
    this.active = false;
    this.clock.clear(this.timer);
    this.timer = undefined;
  }
  pulse = () => {
    if (!this.active || this.running || this.clock.now() - this.last < 4000)
      return;
    this.clock.clear(this.timer);
    this.timer = undefined;
    this.last = this.clock.now();
    this.running = true;
    void (async () => {
      try {
        await this.deps.run();
      } catch (error) {
        this.deps.error(error);
      } finally {
        this.running = false;
        if (this.active)
          this.timer = this.clock.set(this.pulse, this.deps.interval());
      }
    })();
  };
}
