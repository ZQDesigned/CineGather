import { expect, test } from "bun:test";
import { NativeProtocol } from "../src/main/native-protocol";

test("native pipe correlates commands, rejects late data after timeout, and bounds response size", async () => {
  const writes: string[] = [];
  let killed = false;
  const pipe = new NativeProtocol(
    (data) => writes.push(data),
    () => {
      killed = true;
    },
    20,
  );
  const first = pipe.call({ type: "status" });
  await Promise.resolve();
  pipe.receive('{"ok":true,"data":{"engineReady":true}}\n');
  expect(await first).toEqual({ engineReady: true });
  const timed = pipe.call({ type: "start" });
  await expect(timed).rejects.toThrow("超时");
  expect(killed).toBe(true);
  pipe.receive('{"ok":true,"data":{}}\n');
  await expect(pipe.call({ type: "status" })).rejects.toThrow();
  expect(writes).toHaveLength(2);
});

test("helper exit rejects queued commands; concurrent requests cannot steal replies", async () => {
  const writes: string[] = [];
  const pipe = new NativeProtocol(
    (data) => writes.push(data),
    () => {},
    1000,
  );
  const a = pipe.call({ type: "a" });
  const b = pipe.call({ type: "b" });
  await Promise.resolve();
  expect(writes).toHaveLength(1);
  pipe.receive('{"ok":true,"data":{"a":1}}\n');
  expect(await a).toEqual({ a: 1 });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(writes).toHaveLength(2);
  pipe.close();
  await expect(b).rejects.toThrow();
});

test("an invalid multi-response packet immediately rejects the pending operation", async () => {
  let killed = false;
  const pipe = new NativeProtocol(
    () => {},
    () => {
      killed = true;
    },
    1000,
  );
  const result = pipe.call({ type: "status" });
  await Promise.resolve();
  pipe.receive('{"ok":true,"data":{}}\n{"ok":true,"data":{}}\n');
  expect(
    await Promise.race([
      result.then(
        () => "accepted",
        () => "rejected",
      ),
      new Promise((resolve) => setTimeout(() => resolve("unsettled"), 30)),
    ]),
  ).toBe("rejected");
  expect(killed).toBe(true);
});

test("whole-screen sharing requires an explicit application for sound and validates fresh source identity", async () => {
  const { selectNativeSource } = await import("../src/main/native-selection");
  const windows = [
    {
      windowId: 12,
      pid: 34,
      title: "Movie",
      application: "Player",
      bundleId: "org.player",
    },
  ];
  const displays = [{ displayId: 1, name: "显示器 1" }];
  expect(
    selectNativeSource(
      { sourceId: "native:12:34", systemAudio: true },
      windows,
      displays,
    ).application,
  ).toBe("org.player");
  expect(() =>
    selectNativeSource(
      { sourceId: "native:12:35", systemAudio: false },
      windows,
      displays,
    ),
  ).toThrow();
  expect(() =>
    selectNativeSource(
      { sourceId: "native-screen:1", systemAudio: true },
      windows,
      displays,
    ),
  ).toThrow();
  expect(
    selectNativeSource(
      {
        sourceId: "native-screen:1",
        systemAudio: true,
        audioApplication: "org.player",
      },
      windows,
      displays,
    ).displayId,
  ).toBe(1);
  expect(() =>
    selectNativeSource(
      {
        sourceId: "native-screen:1",
        systemAudio: true,
        audioApplication: "city.zqdesigned.cinegather",
      },
      windows,
      displays,
    ),
  ).toThrow();
});

test("canceling source selection discards a delayed native enumeration result", async () => {
  const { NativeCapture } = await import("../src/main/native-capture");
  const { mkdtemp, mkdir, writeFile, access, rm } = await import(
    "node:fs/promises"
  );
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const root = await mkdtemp(join(tmpdir(), "cg-selection-"));
  const executable = join(root, "Contents/MacOS/CGScreenCaptureHost");
  const state = join(root, "state");
  await mkdir(join(root, "Contents/MacOS"), { recursive: true });
  await writeFile(
    executable,
    `#!/usr/bin/env node
const fs=require('node:fs');require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const c=JSON.parse(line);if(c.type==='windows'){fs.writeFileSync(process.argv[2]+'/enumerating','');setTimeout(()=>console.log(JSON.stringify({ok:true,data:{windows:[{windowId:12,pid:34,title:'Movie',application:'Player',bundleId:'org.player'}],displays:[]}})),150)}else{console.log(JSON.stringify({ok:true,data:{engineReady:true}}));if(c.type==='shutdown')setTimeout(()=>process.exit(0),10)}});
`,
    { mode: 0o755 },
  );
  const capture = new NativeCapture(root, state, () => {});
  try {
    const selection = capture.select({
      sourceId: "native:12:34",
      systemAudio: false,
    });
    for (let i = 0; i < 200; i++) {
      try {
        await access(join(state, "enumerating"));
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    }
    capture.cancelSelection();
    await expect(selection).rejects.toThrow("取消");
  } finally {
    await capture.shutdown();
    await rm(root, { recursive: true, force: true });
  }
});

test("development capture excludes the Electron application hosting the room playback", async () => {
  const { selectNativeSource } = await import("../src/main/native-selection");
  const windows = [
    {
      windowId: 7,
      pid: 8,
      title: "Electron",
      application: "Electron",
      bundleId: "com.github.Electron",
    },
  ];
  expect(() =>
    selectNativeSource(
      { sourceId: "native:7:8", systemAudio: true },
      windows,
      [],
      "com.github.Electron",
    ),
  ).toThrow();
  expect(() =>
    selectNativeSource(
      {
        sourceId: "native-screen:1",
        systemAudio: true,
        audioApplication: "com.github.Electron",
      },
      windows,
      [{ displayId: 1, name: "显示器 1" }],
      "com.github.Electron",
    ),
  ).toThrow();
});
