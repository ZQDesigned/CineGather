export interface VisibilityWindow {
  isDestroyed(): boolean;
  isVisible(): boolean;
  isMinimized(): boolean;
}
export interface WindowRectangle {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
export function intersectRectangles(
  a: WindowRectangle,
  b: WindowRectangle,
): WindowRectangle | undefined {
  const rect = {
    left: Math.max(a.left, b.left),
    top: Math.max(a.top, b.top),
    right: Math.min(a.right, b.right),
    bottom: Math.min(a.bottom, b.bottom),
  };
  return rect.right > rect.left && rect.bottom > rect.top ? rect : undefined;
}
export function uncoveredRectangles(
  target: WindowRectangle,
  covers: WindowRectangle[],
): WindowRectangle[] {
  let remaining = [target];
  for (const cover of covers) {
    remaining = remaining.flatMap((rect) => {
      const overlap = intersectRectangles(rect, cover);
      if (!overlap) return [rect];
      return [
        {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: overlap.top,
        },
        {
          left: rect.left,
          top: overlap.bottom,
          right: rect.right,
          bottom: rect.bottom,
        },
        {
          left: rect.left,
          top: overlap.top,
          right: overlap.left,
          bottom: overlap.bottom,
        },
        {
          left: overlap.right,
          top: overlap.top,
          right: rect.right,
          bottom: overlap.bottom,
        },
      ].filter((rect) => rect.right > rect.left && rect.bottom > rect.top);
    });
    // Too many fragments is uncertain, never evidence that playback is hidden.
    if (remaining.length > 128) return [target];
    if (!remaining.length) break;
  }
  return remaining;
}
export class WindowVisibilityMonitor {
  private enabled = false;
  private disposed = false;
  private last?: boolean;
  private timer?: ReturnType<typeof setInterval>;
  constructor(
    private deps: {
      windows(): VisibilityWindow[];
      blocked(): boolean;
      probe: { visible(window: VisibilityWindow): boolean; dispose(): void };
      changed(visible: boolean): void;
    },
  ) {}
  sync() {
    if (!this.enabled || this.disposed) return this.last ?? true;
    const visible =
      !this.deps.blocked() &&
      this.deps.windows().some((window) => {
        if (window.isDestroyed() || !window.isVisible() || window.isMinimized())
          return false;
        try {
          return this.deps.probe.visible(window);
        } catch {
          return true;
        }
      });
    if (visible !== this.last) {
      this.last = visible;
      this.deps.changed(visible);
    }
    return visible;
  }
  watch(enabled: boolean) {
    if (this.disposed) return false;
    this.enabled = enabled;
    if (enabled && !this.timer) {
      this.timer = setInterval(() => this.sync(), 500);
      this.timer.unref();
    }
    if (!enabled) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    return this.sync();
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.enabled = false;
    clearInterval(this.timer);
    this.timer = undefined;
    this.deps.probe.dispose();
  }
}
