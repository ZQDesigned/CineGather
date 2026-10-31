import { expect, test } from "bun:test";
import { MobilePulse } from "../src/mobile-pulse";
function clock() {
  let now = 0,
    id = 0;
  const tasks = new Map<number, () => void>();
  return {
    now: () => now,
    set(fn: () => void, _delay: number) {
      tasks.set(++id, fn);
      return id;
    },
    clear(handle: unknown) {
      tasks.delete(Number(handle));
    },
    advance(ms: number) {
      now += ms;
    },
    fire() {
      const list = [...tasks.values()];
      tasks.clear();
      for (const fn of list) fn();
    },
    get count() {
      return tasks.size;
    },
  };
}
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
test("native pulses keep background sampling alive without concurrent work or multiplying JS timers", async () => {
  const timer = clock();
  let calls = 0,
    finish!: () => void;
  const pulse = new MobilePulse({
    clock: timer,
    interval: () => 5000,
    run: () => {
      calls++;
      return new Promise<void>((r) => {
        finish = r;
      });
    },
    error: () => {},
  });
  pulse.start();
  pulse.pulse();
  expect(calls).toBe(1);
  finish();
  await flush();
  expect(timer.count).toBe(1);
  timer.advance(6000);
  pulse.pulse();
  expect(calls).toBe(2);
  expect(timer.count).toBe(0);
  pulse.pulse();
  expect(calls).toBe(2);
  finish();
  await flush();
  expect(timer.count).toBe(1);
  pulse.stop();
  expect(timer.count).toBe(0);
});
test("a failed native sample does not freeze all future sampling", async () => {
  const timer = clock();
  let calls = 0,
    errors = 0;
  const pulse = new MobilePulse({
    clock: timer,
    interval: () => 5000,
    run: async () => {
      calls++;
      if (calls === 1) throw Error("native read failed");
    },
    error: () => {
      errors++;
    },
  });
  pulse.start();
  await flush();
  expect(errors).toBe(1);
  timer.advance(5000);
  timer.fire();
  await flush();
  expect(calls).toBe(2);
  expect(timer.count).toBe(1);
  pulse.stop();
});
test("stopping a pulse during an in-flight request cannot resurrect its timer", async () => {
  const timer = clock();
  let finish!: () => void;
  const pulse = new MobilePulse({
    clock: timer,
    interval: () => 5000,
    run: () =>
      new Promise<void>((r) => {
        finish = r;
      }),
    error: () => {},
  });
  pulse.start();
  pulse.stop();
  finish();
  await flush();
  expect(timer.count).toBe(0);
});

test("two-second room synchronization keeps recurring instead of stopping at the old diagnostic throttle", async () => {
  const timer = clock();
  let calls = 0;
  const pulse = new MobilePulse({
    clock: timer,
    interval: () => 2000,
    run: async () => {
      calls++;
    },
    error: () => {},
  });
  pulse.start();
  await flush();
  timer.advance(2000);
  timer.fire();
  await flush();
  expect(calls).toBe(2);
  expect(timer.count).toBe(1);
  timer.advance(2000);
  timer.fire();
  await flush();
  expect(calls).toBe(3);
  pulse.stop();
});
test("an early timer or a longer background interval reschedules the remaining delay", async () => {
  const timer = clock();
  let calls = 0,
    interval = 5000;
  const pulse = new MobilePulse({
    clock: timer,
    interval: () => interval,
    run: async () => {
      calls++;
    },
    error: () => {},
  });
  pulse.start();
  await flush();
  timer.advance(1000);
  timer.fire();
  await flush();
  expect(calls).toBe(1);
  expect(timer.count).toBe(1);
  timer.advance(4000);
  timer.fire();
  await flush();
  expect(calls).toBe(2);
  interval = 30000;
  timer.advance(5000);
  timer.fire();
  await flush();
  expect(calls).toBe(2);
  expect(timer.count).toBe(1);
  timer.advance(25000);
  timer.fire();
  await flush();
  expect(calls).toBe(3);
  pulse.stop();
});
