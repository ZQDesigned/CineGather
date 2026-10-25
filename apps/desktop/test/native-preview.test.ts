import { expect, test } from "bun:test";
import { NativeCapture } from "../src/main/native-capture";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("local stream negotiation is scoped to its generation and foreground state without stopping publication", async () => {
  const root = await mkdtemp(join(tmpdir(), "cg-preview-"));
  const work = join(root, "state");
  await mkdir(join(root, "Contents/MacOS"), { recursive: true });
  const sdp =
    "v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=candidate:1 1 UDP 2122260223 127.0.0.1 19001 typ host\r\n";
  await writeFile(
    join(root, "Contents/MacOS/CGScreenCaptureHost"),
    `#!/usr/bin/env node
const fs=require('node:fs');require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const c=JSON.parse(line);let data={screenPermission:true,outputPhase:'active',sourceWidth:1920,outputActive:true,sourcesActive:true};if(c.type==='windows')data={windows:[],displays:[{displayId:1,name:'Screen'}]};if(c.type.startsWith('preview-'))fs.appendFileSync(process.argv[2]+'/requests',c.type+'\\n');if(c.type==='preview-start'){setTimeout(()=>console.log(JSON.stringify({ok:true,data:{sdp:fs.existsSync(process.argv[2]+'/invalid')?'v=0\\r\\na=candidate:1 1 UDP 1 192.0.2.1 9999 typ host\\r\\n':${JSON.stringify(sdp)}}})),60);return}console.log(JSON.stringify({ok:true,data}));if(c.type==='shutdown')setTimeout(()=>process.exit(0),10)});
`,
    { mode: 0o755 },
  );
  const expiresAt = new Date(Date.now() + 20000).toISOString();
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () =>
      Response.json({
        url: "https://example.invalid/whip",
        token: "test-only",
        identity: "test-only",
        expiresAt,
      }),
  });
  let foreground = true;
  const capture = new NativeCapture(root, work, () => {}, undefined, {
    previewAllowed: () => foreground,
  });
  try {
    expect(await capture.startPreview(crypto.randomUUID())).toBeNull();
    await capture.select({ sourceId: "native-screen:1", systemAudio: false });
    await capture.start({
      apiUrl: `http://127.0.0.1:${server.port}`,
      roomId: crypto.randomUUID(),
      sessionToken: "test-only",
      quality: "game",
      lease: {
        leaseId: crypto.randomUUID(),
        holderUserId: crypto.randomUUID(),
        revision: 1,
        expiresAt,
      },
    });
    const a = crypto.randomUUID(),
      b = crypto.randomUUID();
    const pending = capture.startPreview(a);
    const paused = capture.stopPreview(a);
    const next = capture.startPreview(b);
    expect(await pending).toBeNull();
    await paused;
    expect(await next).toEqual({ id: b, sdp });
    expect(await capture.answerPreview(a, sdp)).toBe(false);
    await capture.stopPreview(a);
    expect(await capture.answerPreview(b, sdp)).toBe(true);
    expect(
      (await readFile(join(work, "requests"), "utf8")).trim().split("\n"),
    ).toEqual([
      "preview-start",
      "preview-stop",
      "preview-start",
      "preview-answer",
    ]);
    foreground = false;
    expect(await capture.answerPreview(b, sdp)).toBe(false);
    expect(await capture.startPreview(crypto.randomUUID())).toBeNull();
    expect(capture.isSharing).toBe(true);
    foreground = true;
    await writeFile(join(work, "invalid"), "");
    expect(await capture.startPreview(crypto.randomUUID())).toBeNull();
    expect(capture.isSharing).toBe(true);
    expect(JSON.stringify(capture.diagnostics())).not.toContain(sdp);
    await rm(join(work, "invalid"));
    const id = crypto.randomUUID();
    expect(await capture.startPreview(id)).toEqual({ id, sdp });
    await capture.stop();
    expect(await capture.answerPreview(id, sdp)).toBe(false);
    expect(await capture.startPreview(crypto.randomUUID())).toBeNull();
  } finally {
    await capture.shutdown().catch(() => {});
    server.stop(true);
    await rm(root, { recursive: true, force: true });
  }
});
