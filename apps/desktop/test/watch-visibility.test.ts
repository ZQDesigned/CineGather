import { expect, test } from "bun:test";
import {
  uncoveredRectangles,
  WindowVisibilityMonitor,
} from "../src/main/watch-visibility";
const rect = (left: number, top: number, right: number, bottom: number) => ({
  left,
  top,
  right,
  bottom,
});
test("covering all rectangles pauses, while one visible pixel and holes remain visible", () => {
  const target = rect(0, 0, 100, 100);
  expect(
    uncoveredRectangles(target, [rect(0, 0, 50, 100), rect(50, 0, 100, 100)]),
  ).toEqual([]);
  expect(uncoveredRectangles(target, [rect(0, 0, 99, 100)])).toEqual([
    rect(99, 0, 100, 100),
  ]);
  expect(uncoveredRectangles(target, [rect(10, 10, 90, 90)])).toHaveLength(4);
  expect(uncoveredRectangles(target, [rect(101, 0, 200, 100)])).toEqual([
    target,
  ]);
});
test("negative monitor coordinates and overlapping occluders preserve exposed edges", () => {
  expect(
    uncoveredRectangles(rect(-100, -100, 0, 0), [
      rect(-120, -120, -50, 20),
      rect(-75, -100, 0, 0),
    ]),
  ).toEqual([]);
  expect(
    uncoveredRectangles(rect(-100, -100, 0, 0), [rect(-100, -100, -1, 0)]),
  ).toEqual([rect(-1, -100, 0, 0)]);
});
function fixture() {
  const main = {
    shown: true,
    minimized: false,
    destroyed: false,
    exposed: true,
    isVisible() {
      return this.shown;
    },
    isMinimized() {
      return this.minimized;
    },
    isDestroyed() {
      return this.destroyed;
    },
  };
  const child = { ...main };
  let windows = [main],
    blocked = false,
    calls = 0,
    disposed = 0;
  const changes: boolean[] = [];
  const monitor = new WindowVisibilityMonitor({
    windows: () => windows,
    blocked: () => blocked,
    probe: {
      visible: (w) => {
        calls++;
        return (w as typeof main).exposed;
      },
      dispose: () => {
        disposed++;
      },
    },
    changed: (value) => changes.push(value),
  });
  return {
    main,
    child,
    monitor,
    changes,
    withChild: () => {
      windows = [main, child];
    },
    block: (value: boolean) => {
      blocked = value;
    },
    calls: () => calls,
    disposed: () => disposed,
  };
}
test("a visible viewing child keeps video active, and focus does not participate in visibility", () => {
  const f = fixture();
  try {
    expect(f.monitor.watch(true)).toBe(true);
    f.main.exposed = false;
    f.withChild();
    expect(f.monitor.sync()).toBe(true);
    f.child.exposed = false;
    expect(f.monitor.sync()).toBe(false);
    f.main.exposed = true;
    expect(f.monitor.sync()).toBe(true);
    expect(f.changes).toEqual([true, false, true]);
  } finally {
    f.monitor.dispose();
  }
});
test("minimize, hide, lock, close and disposal stop unnecessary native queries", () => {
  const f = fixture();
  try {
    f.main.minimized = true;
    expect(f.monitor.watch(true)).toBe(false);
    expect(f.calls()).toBe(0);
    f.main.minimized = false;
    expect(f.monitor.sync()).toBe(true);
    f.block(true);
    expect(f.monitor.sync()).toBe(false);
    f.block(false);
    f.main.shown = false;
    expect(f.monitor.sync()).toBe(false);
    f.main.shown = true;
    f.main.destroyed = true;
    expect(f.monitor.sync()).toBe(false);
    f.main.destroyed = false;
    f.monitor.watch(false);
    const calls = f.calls();
    f.monitor.sync();
    expect(f.calls()).toBe(calls);
  } finally {
    f.monitor.dispose();
    f.monitor.dispose();
  }
  expect(f.disposed()).toBe(1);
});
