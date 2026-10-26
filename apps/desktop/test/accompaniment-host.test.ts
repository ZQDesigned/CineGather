import { expect, test, mock } from "bun:test";
import { AccompanimentHost } from "../src/main/accompaniment";

test("application selections are opaque, revalidated, and stale requests cannot stop a newer capture", async () => {
  let targets = [
    { key: "123", name: "Music", target: "window:42", identity: "123:birth" },
  ];
  const start = mock(async () => ({
    sessionId: "native",
    mode: "isolated" as const,
  }));
  const stop = mock(() => {});
  const host = new AccompanimentHost({
    list: async () => targets,
    start,
    stop,
  });
  const [source] = await host.sources();
  expect(source!.id).not.toBe("window:42");
  await expect(host.start("window:42", "bad")).rejects.toThrow("重新选择");
  await host.start(source!.id, "request-a");
  expect(start).toHaveBeenLastCalledWith("window:42");
  const [next] = await host.sources();
  await host.start(next!.id, "request-b");
  const stops = stop.mock.calls.length;
  host.stop("request-a");
  expect(stop.mock.calls.length).toBe(stops);
  host.stop("request-b");
  expect(stop.mock.calls.length).toBe(stops + 1);
  const [closed] = await host.sources();
  targets = [{ ...targets[0]!, identity: "123:reused" }];
  await expect(host.start(closed!.id, "request-c")).rejects.toThrow("已关闭");
});

test("stop while application validation is pending prevents capture from starting", async () => {
  let resolve!: (
    apps: { key: string; name: string; target: string; identity: string }[],
  ) => void;
  const apps = [
    { key: "123", name: "Music", target: "window:42", identity: "123" },
  ];
  let pending = false;
  const start = mock(async () => ({
    sessionId: "native",
    mode: "isolated" as const,
  }));
  const host = new AccompanimentHost({
    list: () =>
      pending
        ? new Promise((r) => {
            resolve = r;
          })
        : Promise.resolve(apps),
    start,
    stop: () => {},
  });
  const [source] = await host.sources();
  pending = true;
  const task = host.start(source!.id, "request-a");
  host.stop("request-a");
  resolve(apps);
  await expect(task).rejects.toThrow("停止");
  expect(start).not.toHaveBeenCalled();
});
