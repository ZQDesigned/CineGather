import { expect, test } from "bun:test";
import { MobileTimers } from "../src/mobile-timers";
test("critical native timers keep firing while UI timers are paused and cancellation rejects late native events", () => {
  const queued: Array<{ id: number; delay: number; repeat: boolean }> = [],
    cancelled: number[] = [];
  const timers = new MobileTimers({
    schedule: (id, delay, repeat) => queued.push({ id, delay, repeat }),
    cancel: (id) => cancelled.push(id),
  });
  let calls = 0;
  const interval = timers.interval(() => calls++, 5000),
    timeout = timers.timeout(() => (calls += 10), 10000);
  expect(queued).toEqual([
    { id: interval, delay: 5000, repeat: true },
    { id: timeout, delay: 10000, repeat: false },
  ]);
  timers.fire(interval);
  timers.fire(interval);
  expect(calls).toBe(2);
  timers.clear(interval);
  timers.fire(interval);
  expect(calls).toBe(2);
  expect(cancelled).toEqual([interval]);
  timers.fire(timeout);
  timers.fire(timeout);
  expect(calls).toBe(12);
});
test("a callback can cancel its repeating native timer and disposing invalidates all callbacks", () => {
  const cancelled: number[] = [];
  const timers = new MobileTimers({
    schedule: () => {},
    cancel: (id) => cancelled.push(id),
  });
  let calls = 0;
  const id = timers.interval(() => {
    calls++;
    timers.clear(id);
  }, 5);
  timers.fire(id);
  timers.fire(id);
  expect(calls).toBe(1);
  const later = timers.timeout(() => calls++, 10);
  timers.dispose();
  timers.fire(later);
  expect(calls).toBe(1);
  expect(cancelled).toContain(later);
});
