import { expect, test, mock } from "bun:test";
import { AccompanimentHost } from "../src/main/audio/accompaniment";

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

test("popular players are identified by executable even when their window shows only the song title", async () => {
  const applications = [
    ["QQMusic.exe", "晴天", "qqmusic"],
    ["cloudmusic.exe", "夜曲", "netease"],
    ["SodaMusic.exe", "正在播放", "soda"],
    ["KuGou.exe", "歌单", "kugou"],
    ["Douyin.exe", "关注", "douyin"],
  ];
  const host = new AccompanimentHost({
    list: async () =>
      applications.map(([executable, name], i) => ({
        key: String(i),
        name: name!,
        target: `process:${i}:123`,
        identity: `${i}:123`,
        executable,
      })),
    start: async () => ({ sessionId: "native", mode: "isolated" }),
    stop: () => {},
  });
  const sources = await host.sources();
  expect(sources.map((s) => s.application)).toEqual([
    "qqmusic",
    "netease",
    "soda",
    "kugou",
    "douyin",
  ]);
  expect(Object.keys(sources[0]!).sort()).toEqual([
    "application",
    "id",
    "name",
  ]);
});

test("a browser or helper with a music player window title remains a custom process", async () => {
  const host = new AccompanimentHost({
    list: async () =>
      ["chrome.exe", "QQMusicHelper.exe", "not-qqmusic.exe"].map(
        (executable, i) => ({
          key: String(i),
          name: "QQ音乐",
          target: `process:${i}:123`,
          identity: `${i}:123`,
          executable,
        }),
      ),
    start: async () => ({ sessionId: "native", mode: "isolated" }),
    stop: () => {},
  });
  expect((await host.sources()).map((s) => s.application)).toEqual([
    undefined,
    undefined,
    undefined,
  ]);
});

test("macOS players use bundle identity and older helpers use exact application names", async () => {
  const host = new AccompanimentHost({
    list: async () =>
      [
        ["com.tencent.QQMusicMac", "播放中"],
        ["com.netease.163music", "播放中"],
        ["com.soda.music", "播放中"],
        ["com.bytedance.douyin.desktop", "播放中"],
        ["com.example.music", "酷狗音乐"],
        ["process:6:123", "QQMusic.exe"],
        ["process:7:123", "QQ音乐 - 浏览器"],
      ].map(([target, name], i) => ({
        key: String(i),
        name: name!,
        target: target!,
        identity: `${i}:123`,
      })),
    start: async () => ({ sessionId: "native", mode: "isolated" }),
    stop: () => {},
  });
  expect((await host.sources()).map((s) => s.application)).toEqual([
    "qqmusic",
    "netease",
    "soda",
    "douyin",
    "kugou",
    "qqmusic",
    undefined,
  ]);
});
