export interface VideoTouch {
  id: string | number;
  x: number;
  y: number;
}
export interface VideoViewportTransform {
  scale: number;
  x: number;
  y: number;
}

/** Local display geometry only; never changes subscriptions or the source stream. */
export class MobileVideoViewport {
  value: VideoViewportTransform = { scale: 1, x: 0, y: 0 };
  private width = 0;
  private height = 0;
  private aspect = 0;
  private gesture?: {
    points: VideoTouch[];
    transform: VideoViewportTransform;
  };
  private tap?: VideoTouch & { time: number; valid: boolean };
  private previousTap?: VideoTouch & { time: number };

  resize(width: number, height: number, aspect: number) {
    if (!(width > 0 && height > 0 && aspect > 0)) return;
    if (
      this.width === width &&
      this.height === height &&
      this.aspect === aspect
    )
      return;
    this.width = width;
    this.height = height;
    this.aspect = aspect;
    this.reset();
  }

  reset() {
    this.value = { scale: 1, x: 0, y: 0 };
    this.cancel();
  }

  zoom(scale: number) {
    this.value = this.bounded(scale, this.value.x, this.value.y);
    this.cancel();
  }

  update(touches: readonly VideoTouch[], time = Date.now()) {
    const points = [...touches]
      .sort((a, b) => String(a.id).localeCompare(String(b.id)))
      .slice(0, 2);
    if (!points.length || !this.width || !this.height) return;
    const first = points[0]!;
    if (!this.gesture) {
      this.tap = { ...first, time, valid: points.length === 1 };
    }
    if (this.tap && (points.length > 1 || distance(first, this.tap) > 8))
      this.tap.valid = false;
    const base = this.gesture;
    if (
      !base ||
      base.points.length !== points.length ||
      base.points.some((p, i) => p.id !== points[i]!.id)
    ) {
      this.gesture = { points, transform: { ...this.value } };
      return;
    }
    const origin = centre(base.points),
      current = centre(points),
      initialDistance =
        base.points.length === 2
          ? distance(base.points[0]!, base.points[1]!)
          : 0;
    // Rebase coincident fingers instead of dividing by a near-zero distance.
    if (points.length === 2 && initialDistance < 2) {
      this.gesture = { points, transform: { ...this.value } };
      return;
    }
    const scale = Math.max(
      1,
      Math.min(
        4,
        base.transform.scale *
          (points.length === 2
            ? distance(points[0]!, points[1]!) / initialDistance
            : 1),
      ),
    );
    const ratio = scale / base.transform.scale;
    this.value = this.bounded(
      scale,
      current.x -
        this.width / 2 -
        (origin.x - this.width / 2 - base.transform.x) * ratio,
      current.y -
        this.height / 2 -
        (origin.y - this.height / 2 - base.transform.y) * ratio,
    );
  }

  finish(time = Date.now()) {
    const tap = this.tap;
    this.gesture = undefined;
    this.tap = undefined;
    if (!tap?.valid || time - tap.time > 250) {
      this.previousTap = undefined;
      return;
    }
    if (
      this.previousTap &&
      time - this.previousTap.time <= 300 &&
      distance(tap, this.previousTap) <= 24
    ) {
      this.reset();
    } else this.previousTap = { ...tap, time };
  }

  cancel() {
    this.gesture = undefined;
    this.tap = undefined;
    this.previousTap = undefined;
  }

  private bounded(scale: number, x: number, y: number) {
    scale = Math.max(1, Math.min(4, scale));
    const fittedWidth = Math.min(this.width, this.height * this.aspect),
      fittedHeight = Math.min(this.height, this.width / this.aspect),
      maxX = Math.max(0, (fittedWidth * scale - this.width) / 2),
      maxY = Math.max(0, (fittedHeight * scale - this.height) / 2);
    return {
      scale,
      x: maxX ? Math.max(-maxX, Math.min(maxX, x)) : 0,
      y: maxY ? Math.max(-maxY, Math.min(maxY, y)) : 0,
    };
  }
}
function distance(a: VideoTouch, b: VideoTouch) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
function centre(points: VideoTouch[]) {
  const a = points[0]!,
    b = points[1] ?? a;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
