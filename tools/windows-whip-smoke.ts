import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, type Page } from "@playwright/test";
import { NativeProtocol } from "../apps/desktop/src/main/native-protocol";
// Real packaged libobs -> patched WHIP -> browser H264 decoder, all on loopback.
export async function windowsWhipSmoke(page: Page, runtime: string) {
  const directory = await mkdtemp(join(tmpdir(), "cg-native-whip-"));
  const child = spawn(
    join(runtime, "bin/64bit/CGScreenCaptureHost.exe"),
    [directory, String(process.pid), "stdio"],
    {
      stdio: "pipe",
      windowsHide: true,
      env: { ...process.env, CG_NATIVE_SYNTHETIC_TEST_LOG: "1" },
    },
  );
  const pipe = new NativeProtocol(
    (data) => child.stdin.write(data),
    () => child.kill(),
  );
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (data) => pipe.receive(data));
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (data) =>
    console.log("Controlled synthetic-only native test stderr:", String(data)),
  );
  child.stdin.on("error", () => pipe.close());
  child.on("error", (error) => pipe.close(error));
  child.on("close", () => pipe.close());
  let posts = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (request.method === "DELETE")
        return new Response(null, { status: 200 });
      if (request.method !== "POST") return new Response(null, { status: 405 });
      posts++;
      const offer = await request.text();
      const answer = await page.evaluate(async (offer) => {
        const peer = new RTCPeerConnection({ iceServers: [] });
        const state = { peer, video: document.createElement("video") };
        state.video.muted = true;
        state.video.autoplay = true;
        document.body.append(state.video);
        (window as unknown as { whipSmoke: typeof state }).whipSmoke = state;
        peer.ontrack = (event) => {
          state.video.srcObject = new MediaStream([event.track]);
          void state.video.play();
        };
        await peer.setRemoteDescription({ type: "offer", sdp: offer });
        await peer.setLocalDescription(await peer.createAnswer());
        if (peer.iceGatheringState !== "complete")
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, 3000);
            peer.onicegatheringstatechange = () => {
              if (peer.iceGatheringState === "complete") {
                clearTimeout(timer);
                resolve();
              }
            };
          });
        return peer.localDescription!.sdp;
      }, offer);
      const candidates = answer
        .split(/\r?\n/)
        .filter((line) => line.startsWith("a=candidate:"));
      console.log(
        "Synthetic receiver ICE candidate types:",
        JSON.stringify({
          count: candidates.length,
          mdns: candidates.filter((line) => /\.local /.test(line)).length,
        }),
      );
      return new Response(answer, {
        status: 201,
        headers: { "Content-Type": "application/sdp", Location: "/resource" },
      });
    },
  });
  try {
    await pipe.call({ type: "status" });
    const result = await pipe.call<{ status: string; framesEncoded: number }>({
      type: "probe",
      encoder: "x264",
      server: `http://127.0.0.1:${server.port}/whip`,
    });
    console.log("Native WHIP probe result:", JSON.stringify({ result, posts }));
    expect(result.status).toBe("ok");
    expect(result.framesEncoded).toBeGreaterThanOrEqual(30);
    const received = await page.evaluate(async () => {
      const state = (
        window as unknown as {
          whipSmoke: { peer: RTCPeerConnection; video: HTMLVideoElement };
        }
      ).whipSmoke;
      const stats = await state.peer.getStats();
      let result: Record<string, unknown> = {};
      stats.forEach((stat) => {
        if (stat.type === "inbound-rtp" && stat.kind === "video")
          result = {
            framesDecoded: stat.framesDecoded,
            framesReceived: stat.framesReceived,
            codec: stats.get(stat.codecId)?.mimeType,
            width: state.video.videoWidth,
            height: state.video.videoHeight,
          };
      });
      return result;
    });
    expect(received.framesDecoded).toBeGreaterThanOrEqual(30);
    expect(received.codec).toBe("video/H264");
    expect(received.width).toBe(1920);
    expect(received.height).toBe(1080);
    console.log(
      "Packaged Windows native WHIP actual 1080p30 loopback:",
      JSON.stringify({ result, received }),
    );
    await pipe.call({ type: "shutdown" });
  } finally {
    child.kill();
    server.stop(true);
    await page.evaluate(() => {
      const state = (
        window as unknown as {
          whipSmoke?: { peer: RTCPeerConnection; video: HTMLVideoElement };
        }
      ).whipSmoke;
      state?.peer.close();
      state?.video.remove();
    });
    await rm(directory, { recursive: true, force: true });
  }
}
