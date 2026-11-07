import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NativeCapture } from "../src/main/capture/native-capture";
import type { NativeCaptureEvent } from "../src/main/capture/native-capture-events";

async function fixture(hang = false) {
  const root = await mkdtemp(join(tmpdir(), "cg-native-startup-"));
  await mkdir(join(root, "bin/64bit"), { recursive: true });
  await writeFile(
    join(root, "bin/64bit/CGScreenCaptureHost.exe"),
    `#!/usr/bin/env node
let active=false,checks=0;const fs=require('node:fs');
const progress=(sequence,state,stage='window-init-graphics')=>process.stderr.write('CG_HOST_PROGRESS '+JSON.stringify({sequence,span:10,commandSequence:4,command:'start',sourceKind:'window',stage,state,elapsedMs:sequence*300,...(state==='held'?{waitMs:200}:{})})+'\\n');
require('node:readline').createInterface({input:process.stdin}).on('line',line=>{
 const c=JSON.parse(line);let data={screenPermission:true,outputPhase:'stopped',sourceWidth:0,sourcesActive:false,outputActive:false};
 if(c.type==='windows')data={windows:[],displays:[{displayId:1,name:'Screen'}]};
 if(c.type==='start'){active=true;progress(1,'begin');data={accepted:true};}
 if(active&&c.type==='status'){
  if(${hang}&&!fs.existsSync(process.argv[2]+'/stalled-once')){fs.writeFileSync(process.argv[2]+'/stalled-once','');progress(2,'held');return;}
  checks++;if(checks<3)data={...data,outputPhase:'starting'};else{progress(3,'complete');data={...data,outputPhase:'active',sourceWidth:1920,sourcesActive:true,outputActive:true};}
 }
 if(c.type==='stop')active=false;
 if(c.type==='encoders')data={encoders:[],adapters:[]};if(c.type==='probe')data={status:'ok',framesEncoded:30};
 console.log(JSON.stringify({ok:true,data}));if(c.type==='shutdown')setTimeout(()=>process.exit(0),5);
});`,
    { mode: 0o755 },
  );
  const events: NativeCaptureEvent[] = [];
  let releases = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (req) => {
      if (req.method === "DELETE") {
        releases++;
        return Response.json({ ok: true });
      }
      return Response.json({
        url: "https://fixture.invalid/whip",
        token: "private-fixture-token",
        identity: "fixture",
        expiresAt: new Date(Date.now() + 25000).toISOString(),
      });
    },
  });
  const capture = new NativeCapture(
    root,
    join(root, "state"),
    () => {},
    undefined,
    { platform: "win32", diagnosticEvent: (e) => events.push(e) },
  );
  return {
    root,
    events,
    capture,
    releases: () => releases,
    context: {
      apiUrl: server.url.origin,
      sessionToken: "private-fixture-token",
      roomId: crypto.randomUUID(),
      quality: "cinema" as const,
      lease: {
        leaseId: crypto.randomUUID(),
        holderUserId: crypto.randomUUID(),
        revision: 1,
        expiresAt: new Date(Date.now() + 25000).toISOString(),
      },
    },
    close: async () => {
      await capture.shutdown().catch(() => {});
      server.stop(true);
      await rm(root, { recursive: true, force: true });
    },
  };
}

test("start ACK is separate from source readiness, and startup progress reaches diagnostics through real child stdio", async () => {
  const f = await fixture();
  try {
    await f.capture.select({ sourceId: "native-screen:1", systemAudio: false });
    await f.capture.start(f.context);
    const accepted = f.events.find((e) => e.name === "native-start-accepted")!;
    expect(accepted.native.startAckMs).toBeGreaterThanOrEqual(0);
    const ready = f.events.find((e) => e.name === "native-source-ready")!;
    expect(ready.native.sourceReadyMs).toBeGreaterThanOrEqual(150);
    expect(ready.native.outputPhase).toBe("active");
    expect(f.events.findIndex((e) => e === accepted)).toBeLessThan(
      f.events.findIndex((e) => e === ready),
    );
    expect(
      f.events.some(
        (e) =>
          e.name === "native-startup-progress" &&
          e.native.progress?.state === "begin",
      ),
    ).toBe(true);
    expect(f.capture.diagnostics()?.pendingProgress).toEqual([]);
    expect(JSON.stringify(f.events)).not.toMatch(
      /fixture.invalid|private-fixture-token/,
    );
  } finally {
    await f.close();
  }
});

test("a blocked post-ACK status preserves pending graphics evidence after timeout and helper rebuild", async () => {
  const f = await fixture(true);
  try {
    await f.capture.select({ sourceId: "native-screen:1", systemAudio: false });
    await expect(f.capture.start(f.context)).rejects.toThrow("响应超时");
    await Bun.sleep(30);
    const failure = f.events.find((e) => e.name === "native-host-timeout")!;
    expect(failure.native.pendingProgress).toEqual([
      expect.objectContaining({
        stage: "window-init-graphics",
        state: "held",
        waitMs: 200,
      }),
    ]);
    const probe = await f.capture.encoderDiagnostics();
    expect(probe?.lastSession?.pendingProgress).toEqual(
      failure.native.pendingProgress,
    );
    expect(probe?.lastSession?.hostSession).toBe(failure.native.hostSession);
    expect(f.events.some((e) => e.name === "native-host-rebuild")).toBe(true);
    expect(f.releases()).toBe(1);
    // The new child can publish without a full application restart.
    await f.capture.select({ sourceId: "native-screen:1", systemAudio: false });
    await f.capture.start(f.context);
    expect(f.capture.diagnostics()?.outputPhase).toBe("active");
    expect(f.capture.diagnostics()?.hostGeneration).toBe(2);
    expect(f.capture.diagnostics()?.pendingProgress).toEqual([]);
  } finally {
    await f.close();
  }
}, 30000);
