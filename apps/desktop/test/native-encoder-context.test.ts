import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NativeCapture } from "../src/main/native-capture";

test("encoder inventory follows the selected screen or exact window and clears a cancelled selection", async () => {
  const root = await mkdtemp(join(tmpdir(), "cg-encoder-source-"));
  await mkdir(join(root, "bin/64bit"), { recursive: true });
  await writeFile(
    join(root, "bin/64bit/CGScreenCaptureHost.exe"),
    `#!/usr/bin/env node
let active=false;require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const c=JSON.parse(line);let data={screenPermission:true,outputPhase:active?'active':'stopped',sourceWidth:1920,sourcesActive:active,outputActive:active};if(c.type==='start'){active=true;data={...data,outputPhase:'active',sourcesActive:true,outputActive:true};}if(c.type==='switch-source'&&c.displayId===3){console.log(JSON.stringify({ok:false,error:'display-unavailable'}));return;}if(c.type==='stop')active=false;if(c.type==='windows')data={windows:[{windowId:12,pid:34,title:'Player',application:'Player.exe',bundleId:'Player.exe'}],displays:[{displayId:1,name:'Screen 1'},{displayId:2,name:'Screen 2'},{displayId:3,name:'Disconnected screen'}]};if(c.type==='encoders')data={encoders:[],adapters:[],...(c.displayId===2||c.windowId===12&&c.pid===34?{captureAdapterIndex:1}:c.displayId===1?{captureAdapterIndex:0}:{})};console.log(JSON.stringify({ok:true,data}));if(c.type==='shutdown')setTimeout(()=>process.exit(0),10)});
`,
    { mode: 0o755 },
  );
  const expiresAt = new Date(Date.now() + 25000).toISOString();
  const lease = {
    leaseId: crypto.randomUUID(),
    holderUserId: crypto.randomUUID(),
    expiresAt,
    revision: 1,
  };
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) =>
      request.url.endsWith("/renew")
        ? Response.json(lease)
        : Response.json({
            url: "https://example.invalid/whip",
            token: "test-only",
            identity: "test-only",
            expiresAt,
          }),
  });
  const capture = new NativeCapture(
    root,
    join(root, "state"),
    () => {},
    undefined,
    { platform: "win32" },
  );
  try {
    expect((await capture.encoders()).captureAdapterIndex).toBeUndefined();
    await capture.select({ sourceId: "native-screen:2", systemAudio: false });
    expect((await capture.encoders()).captureAdapterIndex).toBe(1);
    await capture.select({ sourceId: "native-screen:1", systemAudio: false });
    expect((await capture.encoders()).captureAdapterIndex).toBe(0);
    await capture.select({ sourceId: "native:12:34", systemAudio: false });
    expect((await capture.encoders()).captureAdapterIndex).toBe(1);
    capture.cancelSelection();
    expect((await capture.encoders()).captureAdapterIndex).toBeUndefined();
    await capture.select({ sourceId: "native-screen:2", systemAudio: false });
    await capture.start({
      apiUrl: `http://127.0.0.1:${server.port}`,
      sessionToken: "test-only",
      roomId: crypto.randomUUID(),
      quality: "cinema",
      lease,
    });
    // Consuming the selection must keep the active source available to settings.
    expect((await capture.encoders()).captureAdapterIndex).toBe(1);
    await capture.select({ sourceId: "native-screen:1", systemAudio: false });
    await capture.switchSource();
    expect((await capture.encoders()).captureAdapterIndex).toBe(0);
    await capture.select({ sourceId: "native-screen:3", systemAudio: false });
    await expect(capture.switchSource()).rejects.toThrow();
    expect((await capture.encoders()).captureAdapterIndex).toBe(0);
    await capture.stop();
    expect((await capture.encoders()).captureAdapterIndex).toBeUndefined();
  } finally {
    await capture.shutdown();
    server.stop(true);
    await rm(root, { recursive: true, force: true });
  }
});
