import { test, expect } from "bun:test";
import { watchUpdateEvents } from "../src/update-events";
test("stream handles split CRLF frames and multiple data lines without another HTTP request", async () => {
  let calls = 0,
    done!: () => void;
  const completed = new Promise<void>((r) => (done = r));
  const received: string[] = [];
  const request = async () => {
    calls++;
    return new Response(
      new ReadableStream({
        start(c) {
          for (const chunk of [
            "event: pol",
            'icy\r\ndata: {"minimumVersions":',
            "\r\ndata: {}}\r\n\r",
            "\nevent: release\ndata: signed\n\n",
          ])
            c.enqueue(new TextEncoder().encode(chunk));
          c.close();
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    );
  };
  const stop = watchUpdateEvents(
    "https://example.test/events",
    (type, raw) => {
      received.push(type + ":" + raw);
      if (type === "release") {
        stop();
        done();
      }
    },
    request,
  );
  await completed;
  expect(calls).toBe(1);
  expect(received).toEqual([
    'policy:{"minimumVersions":\n{}}',
    "release:signed",
  ]);
});
test("old servers and disconnects back off, and explicit reconnect cancels the delayed retry", async () => {
  let now = 0,
    calls = 0;
  const tasks = new Map<number, { fn: () => void; ms: number }>();
  let id = 0;
  const clock = {
    now: () => now,
    set: (fn: () => void, ms: number) => {
      tasks.set(++id, { fn, ms });
      return id;
    },
    clear: (key: unknown) => {
      tasks.delete(key as number);
    },
  };
  const request = async () => {
    calls++;
    return new Response(null, { status: 404 });
  };
  const stop = watchUpdateEvents(
    "https://example.test/events",
    () => {},
    request,
    clock,
  );
  await Bun.sleep(0);
  expect(calls).toBe(1);
  expect([...tasks.values()].map((v) => v.ms)).toEqual([3600000]);
  now += 20000;
  stop.reconnect();
  await Bun.sleep(0);
  expect(calls).toBe(2);
  expect(tasks.size).toBe(1);
  stop();
  expect(tasks.size).toBe(0);
});
