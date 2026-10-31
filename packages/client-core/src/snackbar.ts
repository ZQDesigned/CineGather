export type SnackbarTone = "info" | "success" | "error";
export interface SnackbarItem {
  id: number;
  text: string;
  tone: SnackbarTone;
  duration: number;
}
export interface SnackbarSnapshot {
  item?: SnackbarItem;
  phase?: "visible" | "exiting";
  host?: number;
}
interface Clock {
  now(): number;
  setTimeout(run: () => void, delay: number): unknown;
  clearTimeout(id: unknown): void;
}

// One queue across native presentation surfaces: changing the surface must not
// duplicate feedback or restart its timeout.
export class SnackbarQueue {
  private current: SnackbarSnapshot = {};
  private pending: { item: SnackbarItem; time: number }[] = [];
  private recent = new Map<string, number>();
  private hosts = new Map<number, number>();
  private listeners = new Set<() => void>();
  private serial = 0;
  private timer?: unknown;
  private startedAt = 0;
  private foreground = true;
  constructor(
    private readonly clock: Clock = {
      now: Date.now,
      setTimeout: (run, delay) => setTimeout(run, delay),
      clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
    },
  ) {}
  snapshot = () => this.current;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(next: Partial<SnackbarSnapshot>) {
    this.current = { ...this.current, ...next };
    for (const listener of this.listeners) listener();
  }
  private cancel() {
    if (this.timer !== undefined) this.clock.clearTimeout(this.timer);
    this.timer = undefined;
  }
  host(priority: number) {
    const id = ++this.serial;
    this.hosts.set(id, priority);
    this.selectHost();
    return {
      id,
      release: () => {
        if (this.hosts.delete(id)) this.selectHost();
      },
    };
  }
  private selectHost() {
    const host = [...this.hosts].sort(
      (a, b) => b[1] - a[1] || b[0] - a[0],
    )[0]?.[0];
    this.publish({ host });
    this.pump();
  }
  show(input: { text: string; tone?: SnackbarTone }) {
    if (!this.foreground) return;
    const text = input.text.trim().slice(0, 500),
      tone = input.tone ?? "info";
    if (!text) return;
    const now = this.clock.now(),
      key = `${tone}:${text}`;
    for (const [seen, time] of this.recent)
      if (now - time >= 8000) this.recent.delete(seen);
    const repeated = this.recent.has(key);
    this.recent.set(key, now);
    const active = [this.current.item, ...this.pending.map((p) => p.item)].find(
      (item) => item?.text === text && item.tone === tone,
    );
    if (active) return active.id;
    if (repeated) return;
    const item: SnackbarItem = {
      id: ++this.serial,
      text,
      tone,
      duration: tone === "error" ? 6000 : tone === "success" ? 3000 : 4000,
    };
    this.pending.push({ item, time: now });
    this.pending = this.pending.slice(-3);
    this.pump();
    return item.id;
  }
  private pump() {
    if (
      this.current.item ||
      this.current.host === undefined ||
      !this.foreground
    )
      return;
    const now = this.clock.now();
    this.pending = this.pending.filter((entry) => now - entry.time < 15000);
    const next = this.pending.shift();
    if (!next) return;
    this.startedAt = now;
    this.publish({ item: next.item, phase: "visible" });
    this.timer = this.clock.setTimeout(
      () => this.dismiss(next.item.id),
      next.item.duration,
    );
  }
  dismiss(id = this.current.item?.id) {
    if (
      id === undefined ||
      id !== this.current.item?.id ||
      this.current.phase === "exiting"
    )
      return;
    this.cancel();
    this.publish({ phase: "exiting" });
    this.timer = this.clock.setTimeout(() => {
      if (this.current.item?.id !== id) return;
      this.timer = undefined;
      this.publish({ item: undefined, phase: undefined });
      this.pump();
    }, 180);
  }
  extend(id: number, duration: number) {
    const item = this.current.item;
    if (
      !item ||
      item.id !== id ||
      this.current.phase !== "visible" ||
      !Number.isFinite(duration) ||
      duration <= item.duration
    )
      return;
    this.cancel();
    this.publish({ item: { ...item, duration } });
    this.timer = this.clock.setTimeout(
      () => this.dismiss(id),
      Math.max(0, this.startedAt + duration - this.clock.now()),
    );
  }
  clear() {
    this.cancel();
    this.pending = [];
    this.recent.clear();
    this.publish({ item: undefined, phase: undefined });
  }
  setForeground(foreground: boolean) {
    this.foreground = foreground;
    if (!foreground) this.clear();
  }
}
