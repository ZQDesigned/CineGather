import { expect, test } from "bun:test";
import { OverlayStacking } from "../src/main/overlay-stacking";

// Only the native window boundary is substituted; recovery/lifecycle logic is real.
function fixture(platform: NodeJS.Platform = "win32") {
  let visible = true,
    destroyed = false,
    top = false,
    covered = true;
  const calls: string[] = [];
  const window = {
    isDestroyed: () => destroyed,
    isVisible: () => visible,
    setAlwaysOnTop: (value: boolean, level?: string) => {
      top = value && level === "screen-saver";
    },
    moveTop: () => {
      covered = false;
      calls.push("fallback");
    },
  };
  const stack = new OverlayStacking(window, platform, () => {
    top = true;
    covered = false;
    calls.push("native");
  });
  return {
    stack,
    calls,
    state: () => ({ visible, destroyed, top, covered }),
    cover: () => {
      covered = true;
      top = false;
    },
    hide: () => {
      visible = false;
    },
    destroy: () => {
      destroyed = true;
    },
  };
}
test("a visible Windows overlay recovers native demotion and subsequent topmost occlusion", async () => {
  const f = fixture();
  try {
    f.stack.visible(true);
    expect(f.state()).toMatchObject({ top: true, covered: false });
    f.cover();
    await new Promise((r) => setTimeout(r, 1150));
    expect(f.state()).toMatchObject({ top: true, covered: false });
  } finally {
    f.stack.destroy();
  }
});
test("hidden or destroyed overlays never reappear through a stacking repair", async () => {
  const f = fixture();
  try {
    f.stack.visible(true);
    f.hide();
    f.stack.visible(false);
    f.cover();
    const count = f.calls.length;
    await new Promise((r) => setTimeout(r, 1150));
    expect(f.calls.length).toBe(count);
    expect(f.state().covered).toBe(true);
    f.destroy();
    f.stack.visible(true);
    expect(f.calls.length).toBe(count);
  } finally {
    f.stack.destroy();
  }
});
test("Mac overlay stacking never invokes the Windows native repair", async () => {
  const f = fixture("darwin");
  try {
    f.stack.visible(true);
    await new Promise((r) => setTimeout(r, 1150));
    expect(f.calls).toEqual([]);
  } finally {
    f.stack.destroy();
  }
});

test("disposing an active overlay stops repair and cannot be restarted", async () => {
  const f = fixture();
  f.stack.visible(true);
  f.stack.destroy();
  f.cover();
  const count = f.calls.length;
  await new Promise((r) => setTimeout(r, 1150));
  f.stack.visible(true);
  expect(f.calls.length).toBe(count);
  expect(f.state().covered).toBe(true);
});
test("native repair failure retains the non-activating Electron fallback", () => {
  let raised = 0;
  const stack = new OverlayStacking(
    {
      isDestroyed: () => false,
      isVisible: () => true,
      setAlwaysOnTop: () => {},
      moveTop: () => {
        raised++;
      },
    },
    "win32",
    () => {
      throw Error("simulated native binding failure");
    },
  );
  try {
    stack.visible(true);
    expect(raised).toBe(1);
  } finally {
    stack.destroy();
  }
});
