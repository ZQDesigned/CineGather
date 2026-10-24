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

test("screen audio captures the system mix without an application while window audio retains fresh app identity", async () => {
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
  const screen = selectNativeSource(
    { sourceId: "native-screen:1", systemAudio: true },
    [],
    displays,
  );
  expect(screen.displayId).toBe(1);
  expect(screen.application).toBeUndefined();
  expect(
    selectNativeSource(
      { sourceId: "native:12:34", systemAudio: true },
      windows,
      displays,
    ).application,
  ).toBe("org.player");
  expect(() =>
    selectNativeSource(
      { sourceId: "native:12:35", systemAudio: true },
      windows,
      displays,
    ),
  ).toThrow();
  expect(() =>
    selectNativeSource(
      { sourceId: "native-screen:2", systemAudio: true },
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
  expect(
    selectNativeSource(
      { sourceId: "native-screen:1", systemAudio: true },
      windows,
      [{ displayId: 1, name: "显示器 1" }],
      "com.github.Electron",
    ).application,
  ).toBeUndefined();
});

test("source thumbnails preserve native identity, stay bounded and cannot capture unlisted or own sources", async () => {
  const { NativeCapture } = await import("../src/main/native-capture");
  const { mkdtemp, mkdir, writeFile, readFile, rm } = await import(
    "node:fs/promises"
  );
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const root = await mkdtemp(join(tmpdir(), "cg-thumbnails-"));
  const work = join(root, "state");
  await mkdir(join(root, "Contents/MacOS"), { recursive: true });
  const thumbnail = "data:image/jpeg;base64,/9j/2Q==";
  await writeFile(
    join(root, "Contents/MacOS/CGScreenCaptureHost"),
    `#!/usr/bin/env node
const fs=require('node:fs');require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const c=JSON.parse(line);let data={screenPermission:true};if(c.type==='windows')data={windows:[{windowId:12,pid:34,title:'Movie',application:'Player',bundleId:'org.player'},{windowId:7,pid:8,title:'Own',application:'Own',bundleId:'com.github.Electron'}],displays:[{displayId:1,name:'显示器 1'}]};if(c.type==='thumbnails'){fs.appendFileSync(process.argv[2]+'/requests',JSON.stringify(c)+'\\n');data=c.sources.map(s=>({id:s.id,thumbnail:s.windowId===12?${JSON.stringify(thumbnail)}:''}));}console.log(JSON.stringify({ok:true,data}));if(c.type==='shutdown')setTimeout(()=>process.exit(0),10)});
`,
    { mode: 0o755 },
  );
  const capture = new NativeCapture(
    root,
    work,
    () => {},
    "com.github.Electron",
  );
  try {
    await capture.sources();
    const previews = await capture.sourceThumbnails([
      "native:12:34",
      "native-screen:1",
    ]);
    expect(previews).toEqual([
      { id: "native:12:34", thumbnail },
      { id: "native-screen:1", thumbnail: "" },
    ]);
    expect(
      await capture.sourceThumbnails([
        "native:7:8",
        "native:12:999",
        "native-screen:999",
      ]),
    ).toEqual([]);
    expect(
      (await readFile(join(work, "requests"), "utf8")).trim().split("\n"),
    ).toHaveLength(1);
    await expect(
      capture.sourceThumbnails(Array(5).fill("native:12:34")),
    ).rejects.toThrow();
    capture.cancelSelection();
    expect(await capture.sourceThumbnails(["native:12:34"])).toEqual([]);
  } finally {
    await capture.shutdown();
    await rm(root, { recursive: true, force: true });
  }
});

test("an exclusion-filter failure stops native capture and revokes its room lease", async () => {
  const { NativeCapture } = await import("../src/main/native-capture");
  const { mkdtemp, mkdir, writeFile, readFile, rm } = await import(
    "node:fs/promises"
  );
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const root = await mkdtemp(join(tmpdir(), "cg-audio-failure-"));
  const work = join(root, "state");
  await mkdir(join(root, "Contents/MacOS"), { recursive: true });
  await writeFile(
    join(root, "Contents/MacOS/CGScreenCaptureHost"),
    `#!/usr/bin/env node
const fs=require('node:fs');let active=false;require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const c=JSON.parse(line);let data={activeFps:null,screenPermission:true,outputPhase:active?'active':'stopped',sourceWidth:1920,sourcesActive:active,outputActive:active,audioCaptureError:fs.existsSync(process.argv[2]+'/fail')?'exclusion update failed':''};if(c.type==='windows')data={windows:[],displays:[{displayId:1,name:'Screen'}]};if(c.type==='start'){active=true;fs.writeFileSync(process.argv[2]+'/start',JSON.stringify(c));}if(c.type==='stop'){active=false;fs.writeFileSync(process.argv[2]+'/stopped','');}console.log(JSON.stringify({ok:true,data}));if(c.type==='shutdown')setTimeout(()=>process.exit(0),10)});
`,
    { mode: 0o755 },
  );
  let revoked = 0,
    ended = 0;
  const expiresAt = new Date(Date.now() + 20000).toISOString();
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(request) {
      if (request.method === "DELETE") {
        revoked++;
        return Response.json({ ok: true });
      }
      return Response.json({
        url: "https://example.invalid/local-disposable-whip",
        token: "test-only",
        identity: "test-only",
        expiresAt,
      });
    },
  });
  const capture = new NativeCapture(
    root,
    work,
    () => {
      ended++;
    },
    "city.zqdesigned.cinegather",
  );
  try {
    await capture.select({ sourceId: "native-screen:1", systemAudio: true });
    await capture.start({
      apiUrl: `http://127.0.0.1:${server.port}`,
      sessionToken: "test-only",
      roomId: crypto.randomUUID(),
      quality: "cinema",
      lease: {
        leaseId: crypto.randomUUID(),
        holderUserId: crypto.randomUUID(),
        expiresAt,
        revision: 1,
      },
    });
    const command = JSON.parse(await readFile(join(work, "start"), "utf8"));
    expect(command.systemAudio).toBe(true);
    expect(command.application).toBeUndefined();
    expect(command.excludedApplication).toBe("city.zqdesigned.cinegather");
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(ended).toBe(0);
    expect(revoked).toBe(0);
    await writeFile(join(work, "fail"), "");
    for (let i = 0; i < 60 && !ended; i++)
      await new Promise((r) => setTimeout(r, 50));
    expect(ended).toBe(1);
    expect(revoked).toBe(1);
    expect(await readFile(join(work, "stopped"), "utf8")).toBe("");
  } finally {
    await capture.shutdown();
    server.stop(true);
    await rm(root, { recursive: true, force: true });
  }
});
