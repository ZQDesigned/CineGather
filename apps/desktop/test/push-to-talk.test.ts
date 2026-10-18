import { test, expect } from "bun:test";
import { HoldToTalk, shortcutKeys } from "../src/main/push-to-talk";

test("global PTT maps modifier groups per platform and rejects ambiguous or unsupported shortcuts", () => {
  expect(shortcutKeys("CommandOrControl+Shift+Space", "win32")).toEqual([
    [32],
    [17],
    [16],
  ]);
  expect(shortcutKeys("CommandOrControl+Shift+Space", "darwin")).toEqual([
    [49],
    [55, 54],
    [56, 60],
  ]);
  expect(shortcutKeys("Control+Alt+K", "win32")).toEqual([[75], [17], [18]]);
  expect(shortcutKeys("Control+F8", "darwin")).toEqual([[100], [59, 62]]);
  for (const value of [
    "A",
    "Space",
    "Control+A+B",
    "Control+Unknown",
    "Control+Control+K",
  ])
    expect(() => shortcutKeys(value, "win32")).toThrow();
});

test("global PTT opens once while held, releases when any required key lifts and never polls while idle", () => {
  const down = new Set<number>();
  const changes: boolean[] = [];
  let tick: (() => void) | undefined;
  let starts = 0;
  let stops = 0;
  const hold = new HoldToTalk(
    (key) => down.has(key),
    (value) => changes.push(value),
    (next) => {
      starts++;
      tick = next;
      return () => {
        stops++;
        tick = undefined;
      };
    },
  );
  hold.configure([[49], [55, 54]]);
  hold.press();
  expect(changes).toEqual([]);
  expect(starts).toBe(0);
  down.add(49);
  down.add(54);
  hold.press();
  hold.press();
  expect(changes).toEqual([true]);
  expect(starts).toBe(1);
  down.delete(54);
  tick!();
  expect(changes).toEqual([true, false]);
  expect(stops).toBe(1);
  expect(tick).toBeUndefined();
  hold.release();
  expect(changes).toEqual([true, false]);
});

test("reconfiguration, suspend/lock cancellation and native read failure all fail closed", () => {
  let nativeFailure = false;
  const changes: boolean[] = [];
  let tick!: () => void;
  const hold = new HoldToTalk(
    () => {
      if (nativeFailure) throw Error("device unavailable");
      return true;
    },
    (held) => changes.push(held),
    (next) => {
      tick = next;
      return () => {};
    },
  );
  hold.configure([[32], [17]]);
  hold.press();
  hold.configure([[65], [18]]);
  expect(changes).toEqual([true, false]);
  hold.press();
  nativeFailure = true;
  tick();
  expect(changes).toEqual([true, false, true, false]);
  hold.press();
  expect(changes).toHaveLength(4);
  nativeFailure = false;
  hold.press();
  hold.release();
  hold.release();
  expect(changes).toEqual([true, false, true, false, true, false]);
});
