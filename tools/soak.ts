import { chromium, expect, type Page } from "@playwright/test";
import { resolve, sep } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const seconds = Number(process.argv[2] ?? 14400);
if (!Number.isFinite(seconds) || seconds < 30 || seconds > 86400)
  throw new Error(
    "Duration must be 30–86400 seconds; default 14400 (four hours).",
  );
const output = `.local/soak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
await mkdir(output, { recursive: true });
const root = resolve("apps/desktop/out/renderer");
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 15173,
  async fetch(req) {
    const url = new URL(req.url);
    const path = resolve(
      root,
      `.${url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname)}`,
    );
    if (!path.startsWith(root + sep))
      return new Response("Forbidden", { status: 403 });
    const file = Bun.file(path);
    return (await file.exists())
      ? new Response(file)
      : new Response("Not found", { status: 404 });
  },
});
const api = Bun.spawn(["node", "apps/api/dist/main.js"], {
  env: {
    ...process.env,
    API_PORT: "14312",
    CORS_ORIGINS: "http://127.0.0.1:15173",
  },
  stdout: "ignore",
  stderr: "ignore",
});
let aborted = false;
process.once("SIGINT", () => {
  aborted = true;
});
process.once("SIGTERM", () => {
  aborted = true;
});
const startedAt = new Date();
let step = "boot";
const samples: unknown[] = [];
const buildHash = createHash("sha256")
  .update(new Uint8Array(await Bun.file("apps/api/dist/main.js").arrayBuffer()))
  .digest("hex");
const browser = await chromium.launch({
  headless: true,
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
  ],
});
const pages: Page[] = [];
try {
  for (let n = 0; n < 50; n++) {
    try {
      if ((await fetch("http://127.0.0.1:14312/api/v1/health")).ok) break;
    } catch {
      /* Test-owned API boot. */
    }
    await Bun.sleep(100);
  }
  for (let i = 0; i < 5; i++) {
    step = `create-client-${i + 1}`;
    const context = await browser.newContext({
      permissions: ["microphone"],
      viewport: { width: 1360, height: 900 },
    });
    await context.addInitScript(() => {
      localStorage.setItem("cinegather.api", "http://127.0.0.1:14312");
      const peers: RTCPeerConnection[] = [];
      const OriginalPeer = window.RTCPeerConnection;
      window.RTCPeerConnection = class extends OriginalPeer {
        constructor(config?: RTCConfiguration) {
          super(config);
          peers.push(this);
        }
      };
      Object.assign(window, { soakPeers: peers });
      // The capture boundary is synthetic. Encode/send/subscribe/decode, permissions,
      // lease renewal and cleanup are the production application and real SFU.
      Object.defineProperty(window, "desktop", {
        value: {
          platform: "test",
          takeInvitation: async () => undefined,
          sources: async () => [
            {
              id: "screen:synthetic",
              name: "Synthetic 1080p test pattern",
              kind: "screen",
              thumbnail:
                "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9GQAAAAASUVORK5CYII=",
            },
          ],
          selectSource: async () => {},
          cancelCapture: async () => {},
          setSharing: async () => {},
          onAction: () => () => {},
          loadSettings: async () => ({
            minimizeToTray: false,
            pushToTalk: false,
            pttShortcut: "CommandOrControl+Shift+Space",
            muteShortcut: "CommandOrControl+Shift+M",
            quality: "cinema",
            inputDevice: "",
            outputDevice: "",
          }),
          saveSettings: async () => {},
          openExternal: async () => {},
          exportDiagnostics: async () => false,
        },
      });
      navigator.mediaDevices.getDisplayMedia = async (options) => {
        const canvas = document.createElement("canvas");
        canvas.width = 1920;
        canvas.height = 1080;
        const ctx = canvas.getContext("2d")!;
        let frame = 0;
        const draw = () => {
          ctx.fillStyle = "#10131d";
          ctx.fillRect(0, 0, 1920, 1080);
          for (let row = 0; row < 8; row++) {
            ctx.fillStyle = `hsl(${(frame * 2 + row * 35) % 360} 50% 40%)`;
            ctx.fillRect((frame * (row + 2)) % 1600, row * 120, 300, 100);
          }
          ctx.fillStyle = "#fff";
          ctx.font = "48px sans-serif";
          ctx.fillText(`CineGather synthetic media · ${frame++}`, 100, 1030);
        };
        draw();
        const timer = setInterval(draw, 1000 / 30);
        const video = canvas.captureStream(30);
        const context = new AudioContext();
        const osc = context.createOscillator();
        osc.frequency.value = 220;
        const gain = context.createGain();
        gain.gain.value = 0.01;
        const destination = context.createMediaStreamDestination();
        osc.connect(gain).connect(destination);
        osc.start();
        const tracks = [
          ...video.getVideoTracks(),
          ...(options?.audio ? destination.stream.getAudioTracks() : []),
        ];
        let stopped = false;
        for (const track of tracks) {
          const stop = track.stop.bind(track);
          track.stop = () => {
            stop();
            if (!stopped) {
              stopped = true;
              clearInterval(timer);
              osc.stop();
              void context.close();
            }
          };
        }
        return new MediaStream(tracks);
      };
    });
    const page = await context.newPage();
    pages.push(page);
    await page.goto("http://127.0.0.1:15173");
    await page.getByLabel("你的昵称").fill(`稳定性测试 ${i + 1}`);
    await page.getByRole("button", { name: "进入映聚", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: `晚上好，稳定性测试 ${i + 1}` }),
    ).toBeVisible();
  }
  const owner = pages[0]!;
  step = "create-room";
  await owner
    .getByRole("button", { name: "创建私人房间", exact: true })
    .click();
  await owner.getByLabel("房间名称").fill("五人稳定性验证");
  await owner.getByRole("button", { name: "创建并进入" }).click();
  await owner
    .getByRole("button", { name: "关闭麦克风", exact: true })
    .waitFor();
  await owner.getByRole("button", { name: "邀请朋友" }).click();
  const invite = await owner.getByLabel("房间邀请").inputValue();
  await owner.getByRole("button", { name: "关闭对话框" }).click();
  for (const page of pages.slice(1)) {
    await page.getByRole("button", { name: "加入房间", exact: true }).click();
    await page.getByLabel("邀请链接或完整房间码").fill(invite);
    await page.getByRole("button", { name: "进入房间", exact: true }).click();
    await page
      .getByRole("button", { name: "关闭麦克风", exact: true })
      .waitFor({ timeout: 20000 });
  }
  for (const page of pages)
    await expect(page.locator(".members-list .member")).toHaveCount(5);
  step = "publish-screen-and-audio";
  await owner.getByRole("button", { name: "选择屏幕开始共享" }).click();
  await owner.getByRole("checkbox", { name: "共享系统声音" }).check();
  await owner.getByRole("button", { name: "确认共享", exact: true }).click();
  await expect(owner.locator(".sharing-banner")).toBeVisible();
  for (const page of pages.slice(1)) {
    await expect(page.locator(".video-label")).toContainText("含共享声音");
    await expect
      .poll(
        () =>
          page
            .locator("video")
            .evaluate((el) => (el as HTMLVideoElement).videoWidth),
        { timeout: 20000 },
      )
      .toBe(1920);
  }
  const firstViewer = pages[1]!;
  await firstViewer.getByLabel("语音音量").press("End");
  for (let n = 0; n < 25; n++)
    await firstViewer.getByLabel("语音音量").press("ArrowLeft");
  await firstViewer.getByLabel("共享音量").press("Home");
  for (let n = 0; n < 25; n++)
    await firstViewer.getByLabel("共享音量").press("ArrowRight");
  await expect
    .poll(() =>
      firstViewer
        .locator('audio[data-cinegather-audio="screen_share_audio"]')
        .evaluate((el) => (el as HTMLAudioElement).volume),
    )
    .toBe(0.25);
  await expect
    .poll(() =>
      firstViewer
        .locator('audio[data-cinegather-audio="microphone"]')
        .first()
        .evaluate((el) => (el as HTMLAudioElement).volume),
    )
    .toBe(0.75);
  const deadline = Date.now() + seconds * 1000;
  step = "continuous-media";
  console.log(
    `Five clients, one 1080p/30 synthetic screen plus independent audio. Running for ${seconds}s. Report: ${output}`,
  );
  while (Date.now() < deadline && !aborted) {
    const sample = [];
    for (const page of pages) {
      await expect(page.locator(".members-list .member")).toHaveCount(5);
      await expect(page.locator(".connection")).toContainText("已连接");
      sample.push(
        await page.evaluate(async () => {
          const peers = (
            window as unknown as { soakPeers: RTCPeerConnection[] }
          ).soakPeers;
          const stats: Record<string, unknown>[] = [];
          for (const peer of peers)
            if (peer.connectionState === "connected") {
              const report = await peer.getStats();
              report.forEach((stat) => {
                if (
                  ["inbound-rtp", "outbound-rtp", "candidate-pair"].includes(
                    stat.type,
                  )
                ) {
                  const safe: Record<string, unknown> = {};
                  for (const key of [
                    "type",
                    "kind",
                    "bytesSent",
                    "bytesReceived",
                    "packetsLost",
                    "jitter",
                    "framesPerSecond",
                    "framesDecoded",
                    "framesDropped",
                    "frameWidth",
                    "frameHeight",
                    "currentRoundTripTime",
                    "state",
                  ])
                    if (stat[key] !== undefined) safe[key] = stat[key];
                  stats.push(safe);
                }
              });
            }
          const video = document.querySelector("video")!;
          return {
            videoWidth: video.videoWidth,
            videoHeight: video.videoHeight,
            currentTime: video.currentTime,
            decodedFrames: video.getVideoPlaybackQuality().totalVideoFrames,
            audioElements: document.querySelectorAll("audio").length,
            stats,
          };
        }),
      );
    }
    if (samples.length) {
      const previous = samples.at(-1) as {
        clients: { decodedFrames: number }[];
      };
      for (let i = 1; i < sample.length; i++) {
        if (sample[i]!.decodedFrames <= previous.clients[i]!.decodedFrames)
          throw new Error("Receiving video stopped advancing");
      }
    }
    samples.push({
      elapsedSeconds: Math.round((Date.now() - startedAt.getTime()) / 1000),
      clients: sample,
    });
    await writeFile(
      `${output}/progress.json`,
      JSON.stringify(
        {
          status: "running",
          startedAt,
          seconds,
          buildHash,
          lastSample: samples.at(-1),
          sampleCount: samples.length,
        },
        null,
        2,
      ),
    );
    const remaining = deadline - Date.now();
    if (remaining > 0) await Bun.sleep(Math.min(30000, remaining));
  }
  if (aborted) throw new Error("Interrupted");
  for (const page of pages.slice(1)) {
    const width = await page
      .locator("video")
      .evaluate((el) => (el as HTMLVideoElement).videoWidth);
    if (width !== 1920) throw new Error("Final video dimensions lost");
  }
  await writeFile(
    `${output}/result.json`,
    JSON.stringify(
      {
        status: "passed",
        startedAt,
        completedAt: new Date(),
        seconds,
        buildHash,
        capture:
          "synthetic; not a system-audio echo or Windows compatibility test",
        samples,
      },
      null,
      2,
    ),
  );
  console.log(`Continuous media passed for ${seconds}s.`);
} catch (error) {
  await writeFile(
    `${output}/result.json`,
    JSON.stringify(
      {
        status: "failed",
        step,
        errorType: error instanceof Error ? error.name : "Unknown",
        startedAt,
        failedAt: new Date(),
        seconds,
        buildHash,
        samples,
      },
      null,
      2,
    ),
  );
  console.error(`Soak failed at ${step}; see ${output}/result.json.`);
  process.exitCode = 1;
} finally {
  for (const page of pages)
    await page
      .getByRole("button", { name: "离开房间", exact: true })
      .click({ timeout: 3000 })
      .catch(() => {});
  await browser.close();
  server.stop();
  api.kill("SIGTERM");
  await api.exited;
}
