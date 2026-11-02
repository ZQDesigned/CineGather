// Platform renderers and RTC statistics can both witness an actual decoded
// frame. Publication metadata/track subscription alone is never sufficient.
export class FirstVideoFrame {
  private witnessed?: string;
  private closed = false;
  private waiters = new Set<{
    resolve(): void;
    reject(error: unknown): void;
  }>();
  constructor(private readonly currentTrack: () => string | undefined) {}
  rendered(track: string, width: number, height: number) {
    if (
      Number.isFinite(width) &&
      Number.isFinite(height) &&
      width > 0 &&
      height > 0
    )
      this.accept(track);
  }
  stats(track: string, reports: Iterable<unknown>) {
    for (const raw of reports) {
      if (!raw || typeof raw !== "object") continue;
      const stat = raw as Record<string, unknown>;
      if (
        stat.type === "inbound-rtp" &&
        (stat.kind === "video" || stat.mediaType === "video") &&
        typeof stat.framesDecoded === "number" &&
        stat.framesDecoded > 0
      ) {
        this.accept(track);
        return;
      }
    }
  }
  private accept(track: string) {
    if (this.closed || this.currentTrack() !== track) return;
    this.witnessed = track;
    for (const waiter of [...this.waiters]) waiter.resolve();
  }
  wait(signal: AbortSignal): Promise<void> {
    if (this.closed) return Promise.reject(new Error("画面通道已关闭"));
    if (signal.aborted)
      return Promise.reject(signal.reason ?? new Error("画面预热已取消"));
    if (this.witnessed && this.witnessed === this.currentTrack())
      return Promise.resolve();
    return new Promise((resolve, reject) => {
      const clean = () => {
        this.waiters.delete(waiter);
        signal.removeEventListener("abort", abort);
      };
      const waiter = {
        resolve: () => {
          clean();
          resolve();
        },
        reject: (error: unknown) => {
          clean();
          reject(error);
        },
      };
      const abort = () =>
        waiter.reject(
          signal.reason ??
            Object.assign(new Error("Cancelled"), { name: "AbortError" }),
        );
      this.waiters.add(waiter);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
  }
  close() {
    this.closed = true;
    this.witnessed = undefined;
    for (const waiter of [...this.waiters])
      waiter.reject(new Error("画面通道已关闭"));
  }
}
