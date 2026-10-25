import { expect, test } from "bun:test";
import { NativeCapture } from "../src/main/native-capture";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("local preview is bounded, coalesced and discarded when sharing stops", async () => {
  const root = await mkdtemp(join(tmpdir(), "cg-preview-"));
  const work = join(root, "state");
  await mkdir(join(root, "Contents/MacOS"), { recursive: true });
  const image = "data:image/jpeg;base64,/9j/2Q==";
  await writeFile(
    join(root, "Contents/MacOS/CGScreenCaptureHost"),
    `#!/usr/bin/env node
const fs=require('node:fs');require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const c=JSON.parse(line);let data={screenPermission:true,outputPhase:'active',sourceWidth:1920,outputActive:true,sourcesActive:true};if(c.type==='windows')data={windows:[],displays:[{displayId:1,name:'Screen'}]};if(c.type==='preview'){fs.appendFileSync(process.argv[2]+'/previews','1');setTimeout(()=>console.log(JSON.stringify({ok:true,data:fs.existsSync(process.argv[2]+'/invalid')?{image:'https://untrusted.invalid/frame',width:960,height:540}:{image:${JSON.stringify(image)},width:960,height:540}})),60);return}console.log(JSON.stringify({ok:true,data}));if(c.type==='shutdown')setTimeout(()=>process.exit(0),10)});
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
  const capture = new NativeCapture(root, work, () => {});
  try {
    expect(await capture.preview()).toBeNull();
    await capture.select({ sourceId: "native-screen:1", systemAudio: false });
    await capture.start({
      apiUrl: `http://127.0.0.1:${server.port}`,
      roomId: crypto.randomUUID(),
      sessionToken: "test-only",
      quality: "cinema",
      lease: {
        leaseId: crypto.randomUUID(),
        holderUserId: crypto.randomUUID(),
        revision: 1,
        expiresAt,
      },
    });
    const results = await Promise.all(
      Array.from({ length: 10 }, () => capture.preview()),
    );
    expect(results).toEqual(Array(10).fill({ image, width: 960, height: 540 }));
    expect(JSON.stringify(capture.diagnostics())).not.toContain(image);
    expect(await readFile(join(work, "previews"), "utf8")).toBe("1");
    expect(await capture.preview()).toEqual({ image, width: 960, height: 540 });
    expect(await readFile(join(work, "previews"), "utf8")).toBe("1");
    await new Promise((resolve) => setTimeout(resolve, 210));
    await writeFile(join(work, "invalid"), "");
    expect(await capture.preview()).toBeNull();
    await rm(join(work, "invalid"));
    await new Promise((resolve) => setTimeout(resolve, 210));
    const late = capture.preview();
    await capture.stop();
    expect(await late).toBeNull();
    expect(await capture.preview()).toBeNull();
  } finally {
    await capture.shutdown().catch(() => {});
    server.stop(true);
    await rm(root, { recursive: true, force: true });
  }
});
