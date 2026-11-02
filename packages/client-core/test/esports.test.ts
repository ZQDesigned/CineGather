import { expect, test } from "bun:test";
import type { EsportsSnapshot, EsportsChannel } from "@cinegather/contracts";
import { EsportsCoordinator, type EsportsMediaHandle } from "../src/esports";
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function harness(pauseCommit?: () => Promise<void>) {
  const calls: string[] = [],
    handles = new Map<
      string,
      EsportsMediaHandle & { frame: () => void; drop: () => void }
    >();
  const snapshot: EsportsSnapshot = {
    roomId: id(1),
    ownerUserId: id(2),
    members: [],
    publications: [3, 4, 5].map((n) => ({
      id: id(n),
      userId: id(n + 10),
      status: "active",
      systemAudio: true,
    })),
    self: {
      userId: id(9),
      displayName: "观众",
      seat: { kind: "audience" },
      revision: 1,
      online: true,
      reservedUntil: null,
      microphoneAllowed: true,
      sharingAllowed: true,
    },
    watch: {
      revision: 0,
      current: null,
      warming: null,
      warmDeadline: null,
      monitorTeam: null,
      autoMonitor: true,
    },
  };
  const clone = () => structuredClone(snapshot);
  const coordinator = new EsportsCoordinator(
    {
      api: {
        connection: async (channel: EsportsChannel) => ({
          channel:
            channel.kind === "video"
              ? channel.publicationId
              : channel.kind === "team"
                ? channel.team
                : channel.kind,
          url: "ws://test",
          token: "never-diagnose-this-token",
          seatRevision: snapshot.self.revision,
        }),
        watch: async (input) => {
          expect(input.revision).toBe(snapshot.watch.revision);
          calls.push(input.action);
          snapshot.watch.revision++;
          if (input.action === "select") {
            snapshot.watch.warming = input.publicationId!;
            snapshot.watch.warmDeadline = new Date(
              Date.now() + 5000,
            ).toISOString();
          } else if (input.action === "commit") {
            snapshot.watch.current = snapshot.watch.warming;
            snapshot.watch.warming = null;
            snapshot.watch.warmDeadline = null;
            snapshot.watch.monitorTeam = snapshot.watch.autoMonitor
              ? "a"
              : null;
          } else {
            snapshot.watch.warming = null;
            snapshot.watch.warmDeadline = null;
            if (input.action === "stop") {
              snapshot.watch.current = null;
              snapshot.watch.monitorTeam = null;
            }
          }
          if (input.action === "commit") await pauseCommit?.();
          return clone();
        },
        monitor: async (input) => {
          snapshot.watch.revision++;
          snapshot.watch.autoMonitor =
            input.autoMonitor ?? snapshot.watch.autoMonitor;
          snapshot.watch.monitorTeam =
            input.enabled === false
              ? null
              : snapshot.watch.current
                ? "a"
                : null;
          return clone();
        },
      },
      media: {
        open: async (connection, kind) => {
          calls.push("open:" + connection.channel);
          let frame!: () => void;
          let connected = true;
          const ready = new Promise<void>((r) => (frame = r));
          const h = {
            ready: () => ready,
            connected: () => connected,
            drop: () => {
              connected = false;
            },
            close: async () => {
              connected = false;
              calls.push("close:" + connection.channel);
            },
            video: (v: boolean) => {
              calls.push(`video:${connection.channel}:${v}`);
            },
            audio: (v: boolean) => {
              calls.push(`audio:${connection.channel}:${v}`);
            },
            frame,
          };
          handles.set(connection.channel, h);
          if (kind !== "video") frame();
          return h;
        },
        show: (h) => {
          calls.push("show:" + [...handles].find(([, v]) => v === h)?.[0]);
        },
        muteMicrophone: async () => {
          calls.push("mute");
        },
      },
      changed: () => {},
      error: (e) => calls.push("error:" + String(e)),
    },
    { prewarmMs: 30 },
  );
  return { coordinator, calls, handles, snapshot: clone };
}
const tick = () => Bun.sleep(1);
test("the first actual frame commits a warmed stream; a later selection keeps the old view until ready", async () => {
  const h = harness();
  await h.coordinator.start(h.snapshot());
  const first = h.coordinator.select(id(3));
  await tick();
  expect(h.calls).not.toContain("commit");
  h.handles.get(id(3))!.frame();
  await first;
  expect(h.coordinator.state.watching).toBe(id(3));
  expect(h.calls).toContain("open:a");
  const next = h.coordinator.select(id(4));
  await tick();
  expect(h.coordinator.state.watching).toBe(id(3));
  expect(h.calls).not.toContain("close:" + id(3));
  h.handles.get(id(4))!.frame();
  await next;
  expect(h.coordinator.state.watching).toBe(id(4));
  expect(h.calls.indexOf("audio:" + id(3) + ":false")).toBeLessThan(
    h.calls.indexOf("audio:" + id(4) + ":true"),
  );
  expect(JSON.stringify(h.coordinator.diagnostics())).not.toContain(
    "never-diagnose",
  );
  await h.coordinator.stop();
});
test("rapid selections cancel obsolete warming and stale frame callbacks never commit", async () => {
  const h = harness();
  await h.coordinator.start(h.snapshot());
  const old = h.coordinator.select(id(3));
  await tick();
  const next = h.coordinator.select(id(4));
  await tick();
  h.handles.get(id(3))!.frame();
  await old;
  await tick();
  h.handles.get(id(4))!.frame();
  await next;
  expect(h.coordinator.state.watching).toBe(id(4));
  expect(h.calls.filter((x) => x === "commit")).toHaveLength(1);
  await h.coordinator.stop();
});
test("warming timeout rolls back and invisible windows pause video while retaining current audio and seat voice", async () => {
  const h = harness();
  await h.coordinator.start(h.snapshot());
  const first = h.coordinator.select(id(3));
  await tick();
  h.handles.get(id(3))!.frame();
  await first;
  await h.coordinator.select(id(4));
  expect(h.coordinator.state.watching).toBe(id(3));
  expect(h.calls).toContain("cancel");
  h.calls.length = 0;
  await h.coordinator.setVisible(false);
  expect(h.calls).toContain("video:" + id(3) + ":false");
  expect(h.calls).not.toContain("close:audience");
  expect(h.calls).not.toContain("audio:" + id(3) + ":false");
  await h.coordinator.stop();
});
test("seat changes close all forbidden channels and mute before entering the new voice seat", async () => {
  const h = harness();
  await h.coordinator.start(h.snapshot());
  const next = h.snapshot();
  next.self.seat = { kind: "player", team: "b" };
  next.self.revision = 2;
  await h.coordinator.sync(next);
  expect(h.calls).toContain("close:audience");
  expect(h.calls).toContain("open:b");
  expect(h.calls.lastIndexOf("mute")).toBeLessThan(h.calls.indexOf("open:b"));
  await expect(h.coordinator.select(id(3))).rejects.toThrow();
  await h.coordinator.stop();
});

test("manual monitoring and stop watching preserve own-seat voice, and same-team player switches keep its monitor", async () => {
  const h = harness();
  await h.coordinator.start(h.snapshot());
  const first = h.coordinator.select(id(3));
  await tick();
  h.handles.get(id(3))!.frame();
  await first;
  const next = h.coordinator.select(id(4));
  await tick();
  h.handles.get(id(4))!.frame();
  await next;
  expect(h.calls).not.toContain("close:a");
  await h.coordinator.monitor({ enabled: false });
  expect(h.calls).toContain("close:a");
  expect(h.calls).not.toContain("close:audience");
  await h.coordinator.stopWatching();
  expect(h.coordinator.state.watching).toBeUndefined();
  expect(h.calls).not.toContain("close:audience");
  await h.coordinator.stop();
});
test("a selection queued during an already-started commit warms from the committed picture instead of losing it", async () => {
  let release!: () => void,
    entered = false;
  let once = true;
  const pending = new Promise<void>((r) => (release = r));
  const h = harness(async () => {
    if (once) {
      once = false;
      entered = true;
      await pending;
    }
  });
  await h.coordinator.start(h.snapshot());
  const first = h.coordinator.select(id(3));
  await tick();
  h.handles.get(id(3))!.frame();
  await tick();
  expect(entered).toBe(true);
  const next = h.coordinator.select(id(4));
  release();
  await first;
  await tick();
  expect(h.coordinator.state.watching).toBe(id(3));
  h.handles.get(id(4))!.frame();
  await next;
  expect(h.coordinator.state.watching).toBe(id(4));
  await h.coordinator.stop();
});

test("unchanged snapshots recover disconnected voice muted and replace a dead video only after decoded frame", async () => {
  const h = harness();
  await h.coordinator.start(h.snapshot());
  const first = h.coordinator.select(id(3));
  await tick();
  h.handles.get(id(3))!.frame();
  await first;
  const oldVoice = h.handles.get("audience")!,
    oldVideo = h.handles.get(id(3))!;
  oldVoice.drop();
  oldVideo.drop();
  h.handles.get("a")!.drop();
  const at = h.calls.length;
  const sync = h.coordinator.sync(h.snapshot());
  await tick();
  expect(h.handles.get("audience")).not.toBe(oldVoice);
  expect(h.calls.slice(at)).toContain("mute");
  expect(h.calls.slice(at)).not.toContain("close:" + id(3));
  h.handles.get(id(3))!.frame();
  await sync;
  expect(h.calls.slice(at)).toContain("close:" + id(3));
  expect(h.calls.slice(at)).toContain("open:a");
  expect(h.calls.slice(at)).not.toContain("select");
  expect(h.coordinator.state.watching).toBe(id(3));
  await h.coordinator.stop();
});
