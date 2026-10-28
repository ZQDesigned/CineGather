import { registerTestAccount } from "./helpers/account";
import { test, expect, type Page } from "@playwright/test";
async function guest(page: Page, name: string) {
  await page.goto("/");
  await registerTestAccount(page, name);
  await expect(
    page.getByRole("heading", { name: `晚上好，${name}` }),
  ).toBeVisible();
}
async function observeMedia(page: Page) {
  await page.addInitScript(() => {
    // Keep multi-peer fixtures visible unless a test explicitly changes it;
    // browser-window occlusion is verified separately with native fixtures.
    const visibility = { hidden: false };
    Object.assign(window, { visibilityProbe: visibility });
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => visibility.hidden,
    });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => (visibility.hidden ? "hidden" : "visible"),
    });
    const connections: RTCPeerConnection[] = [];
    const Original = RTCPeerConnection;
    class Observed extends Original {
      constructor(...args: ConstructorParameters<typeof RTCPeerConnection>) {
        super(...args);
        connections.push(this);
      }
    }
    Object.assign(window, {
      RTCPeerConnection: Observed,
      subscriptionProbe: { connections },
    });
  });
}
async function receivedTracks(page: Page) {
  return page.evaluate(async () => {
    const { connections } = (
      window as unknown as {
        subscriptionProbe: { connections: RTCPeerConnection[] };
      }
    ).subscriptionProbe;
    const counts = { audio: 0, video: 0 };
    for (const connection of connections) {
      if (connection.connectionState === "closed") continue;
      (await connection.getStats()).forEach((stat) => {
        if (stat.type === "inbound-rtp" && stat.bytesReceived > 0) {
          if (stat.kind === "audio") counts.audio++;
          if (stat.kind === "video") counts.video++;
        }
      });
    }
    return counts;
  });
}
async function join(page: Page, name: string, invite: string) {
  await guest(page, name);
  await page.getByRole("button", { name: "加入房间", exact: true }).click();
  await page.getByLabel("房间号或邀请链接").fill(invite);
  await page.getByRole("button", { name: "进入房间", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "关闭麦克风", exact: true }),
  ).toBeEnabled();
}
async function receivedBytes(page: Page, trackIds: string[]) {
  return page.evaluate(async (trackIds) => {
    const { connections } = (
      window as unknown as {
        subscriptionProbe: { connections: RTCPeerConnection[] };
      }
    ).subscriptionProbe;
    let bytes = 0;
    for (const connection of connections) {
      if (connection.connectionState === "closed") continue;
      (await connection.getStats()).forEach((s) => {
        if (s.type === "inbound-rtp" && trackIds.includes(s.trackIdentifier))
          bytes += s.bytesReceived ?? 0;
      });
    }
    return bytes;
  }, trackIds);
}
async function expectNotReceiving(page: Page) {
  await expect(
    page.getByRole("heading", { name: "同步共享者 正在共享", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "加入观看", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.locator("video").evaluate((v: HTMLVideoElement) => v.srcObject),
    )
    .toBeNull();
}
test("film audio/video share one presentation element and removing audio keeps the video element alive", async ({
  page,
  browser,
}) => {
  await guest(page, "同步共享者");
  await page.getByRole("button", { name: "创建私人房间", exact: true }).click();
  await page.getByLabel("房间名称").fill("共同播放时钟");
  await page.getByRole("button", { name: "创建并进入" }).click();
  await page.getByRole("button", { name: "邀请朋友" }).click();
  const invite = await page.getByLabel("房间邀请").inputValue();
  await page.getByRole("button", { name: "关闭对话框" }).click();
  const context = await browser.newContext({ permissions: ["microphone"] });
  const viewer = await context.newPage();
  const lateContext = await browser.newContext({ permissions: ["microphone"] });
  const late = await lateContext.newPage();
  await observeMedia(viewer);
  await observeMedia(late);
  try {
    await join(viewer, "同步接收者", invite);
    await expect
      .poll(() => receivedTracks(viewer))
      .toEqual({ audio: 1, video: 0 });
    await page.evaluate(() => {
      Object.assign(window, {
        desktop: {
          platform: "test",
          sources: async () => [
            {
              id: "screen:synthetic",
              name: "受控音画源",
              kind: "screen",
              thumbnail: "",
            },
          ],
          selectSource: async () => {},
          cancelCapture: async () => {},
          setSharing: async () => {},
        },
      });
      navigator.mediaDevices.getDisplayMedia = async () => {
        const canvas = document.createElement("canvas");
        canvas.width = 320;
        canvas.height = 180;
        const ctx = canvas.getContext("2d")!;
        const timer = setInterval(() => {
          ctx.fillStyle = `hsl(${Date.now() % 360}, 80%, 50%)`;
          ctx.fillRect(0, 0, 320, 180);
        }, 33);
        const video = canvas.captureStream(30).getVideoTracks()[0]!;
        video.addEventListener("ended", () => clearInterval(timer));
        const ac = new AudioContext(),
          oscillator = ac.createOscillator(),
          destination = ac.createMediaStreamDestination();
        oscillator.connect(destination);
        oscillator.start();
        await ac.resume();
        const audio = destination.stream.getAudioTracks()[0]!;
        audio.addEventListener("ended", () => {
          oscillator.stop();
          void ac.close();
        });
        return new MediaStream([video, audio]);
      };
      const fullscreen = {
        requests: 0,
        exits: 0,
        element: null as Element | null,
      };
      Object.assign(window, { fullscreenProbe: fullscreen });
      Object.defineProperty(document, "fullscreenElement", {
        configurable: true,
        get: () => fullscreen.element,
      });
      Element.prototype.requestFullscreen = async function () {
        fullscreen.requests++;
        fullscreen.element = this;
      };
      Document.prototype.exitFullscreen = async function () {
        fullscreen.exits++;
        fullscreen.element = null;
      };
    });
    // Starting a share while viewing the empty stage fullscreen must exit it.
    await page.getByRole("button", { name: "全屏画面", exact: true }).click();
    for (let cycle = 0; cycle < 2; cycle++) {
      await page
        .getByRole("button", { name: "选择屏幕开始共享", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "全屏画面", exact: true }),
      ).toHaveCount(0);
      expect(
        await page.evaluate(() => document.fullscreenElement === null),
      ).toBe(true);
      await page.getByRole("checkbox", { name: "共享系统声音" }).check();
      await page.getByRole("button", { name: "确认共享", exact: true }).click();
      // A browser publisher retains its local preview without subscribing to
      // its own stream through the SFU.
      await expect(page.locator(".stage-empty")).toHaveCount(0);
      await expect(viewer.locator(".video-label")).toContainText("含共享声音");
      await expectNotReceiving(viewer);
      if (cycle === 0) {
        expect(await receivedTracks(viewer)).toEqual({ audio: 1, video: 0 });
        await join(late, "晚加入接收者", invite);
        await expectNotReceiving(late);
        // Voice from both room members is received, but no shared audio/video
        // track may reach the peer connection before the explicit viewing action.
        await expect
          .poll(() => receivedTracks(late))
          .toEqual({ audio: 2, video: 0 });
        await late.screenshot({
          path: ".local/on-demand-viewing/late-viewer.png",
        });
        await late
          .getByRole("button", { name: "离开房间", exact: true })
          .click();
        await expect(late.locator(".connection")).toContainText("未连接房间", {
          timeout: 15000,
        });
        await expectNotReceiving(viewer);
        expect(await receivedTracks(viewer)).toMatchObject({ video: 0 });
      }
      await viewer
        .getByRole("button", { name: "加入观看", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "全屏画面", exact: true }),
      ).toHaveCount(0);
      await expect(
        viewer.getByRole("button", { name: "全屏画面", exact: true }),
      ).toBeEnabled();
      await page.locator(".stage").dblclick();
      expect(
        await page.evaluate(
          () =>
            (
              window as unknown as {
                fullscreenProbe: { requests: number; exits: number };
              }
            ).fullscreenProbe,
        ),
      ).toMatchObject({ requests: 1, exits: 1 });
      await expect
        .poll(() =>
          viewer
            .locator("video")
            .evaluate(
              (v) =>
                (
                  (v as HTMLVideoElement).srcObject as MediaStream | null
                )?.getAudioTracks().length ?? 0,
            ),
        )
        .toBe(1);
      await expect
        .poll(() =>
          viewer
            .locator("video")
            .evaluate((v) => (v as HTMLVideoElement).videoWidth),
        )
        .toBeGreaterThan(0);
      expect(
        await viewer
          .locator('audio[data-cinegather-audio="screen_share_audio"]')
          .count(),
      ).toBe(0);
      let sharedTrackIds = await viewer
        .locator("video")
        .evaluate((v: HTMLVideoElement) =>
          (v.srcObject as MediaStream).getTracks().map((t) => t.id),
        );
      await expect
        .poll(() => receivedBytes(viewer, sharedTrackIds))
        .toBeGreaterThan(0);
      if (cycle === 0) {
        const tracks = await viewer
          .locator("video")
          .evaluate((v: HTMLVideoElement) => {
            const stream = v.srcObject as MediaStream;
            return {
              video: stream.getVideoTracks().map((t) => t.id),
              audio: stream.getAudioTracks().map((t) => t.id),
              time: v.currentTime,
            };
          });
        await viewer.evaluate(() => {
          (
            window as unknown as { visibilityProbe: { hidden: boolean } }
          ).visibilityProbe.hidden = true;
          document.dispatchEvent(new Event("visibilitychange"));
        });
        await expect
          .poll(() =>
            viewer
              .locator("video")
              .evaluate((v: HTMLVideoElement) => ({
                video:
                  (v.srcObject as MediaStream | null)?.getVideoTracks()
                    .length ?? 0,
                audio:
                  (v.srcObject as MediaStream | null)?.getAudioTracks()
                    .length ?? 0,
              })),
          )
          .toEqual({ video: 0, audio: 1 });
        await expect
          .poll(async () => {
            const before = await receivedBytes(viewer, tracks.video);
            await new Promise((resolve) => setTimeout(resolve, 500));
            return (await receivedBytes(viewer, tracks.video)) - before;
          })
          .toBe(0);
        const audioBefore = await receivedBytes(viewer, tracks.audio);
        await expect
          .poll(() => receivedBytes(viewer, tracks.audio))
          .toBeGreaterThan(audioBefore);
        await expect
          .poll(() =>
            viewer
              .locator("video")
              .evaluate((v: HTMLVideoElement) => v.currentTime),
          )
          .toBeGreaterThan(tracks.time + 0.5);
        await expect(
          viewer.getByRole("button", { name: "暂停观看", exact: true }),
        ).toBeVisible();
        await expect(
          viewer.getByRole("button", { name: "加入观看", exact: true }),
        ).toHaveCount(0);
        await viewer.evaluate(() => {
          (
            window as unknown as { visibilityProbe: { hidden: boolean } }
          ).visibilityProbe.hidden = false;
          document.dispatchEvent(new Event("visibilitychange"));
        });
        await expect
          .poll(() =>
            viewer
              .locator("video")
              .evaluate(
                (v: HTMLVideoElement) =>
                  (v.srcObject as MediaStream | null)?.getVideoTracks()
                    .length ?? 0,
              ),
          )
          .toBe(1);
        await expect
          .poll(() =>
            viewer
              .locator("video")
              .evaluate((v: HTMLVideoElement) => v.videoWidth),
          )
          .toBeGreaterThan(0);
        sharedTrackIds = await viewer
          .locator("video")
          .evaluate((v: HTMLVideoElement) =>
            (v.srcObject as MediaStream).getTracks().map((t) => t.id),
          );
      }
      await viewer
        .getByRole("button", { name: "暂停观看", exact: true })
        .click();
      await expectNotReceiving(viewer);
      await expect
        .poll(async () => {
          const before = await receivedBytes(viewer, sharedTrackIds);
          await new Promise((resolve) => setTimeout(resolve, 350));
          return (await receivedBytes(viewer, sharedTrackIds)) - before;
        })
        .toBe(0);
      await expect(
        viewer.locator('audio[data-cinegather-audio="microphone"]'),
      ).toHaveCount(1);
      await viewer
        .getByRole("button", { name: "加入观看", exact: true })
        .click();
      await expect
        .poll(() =>
          viewer
            .locator("video")
            .evaluate(
              (v: HTMLVideoElement) =>
                (v.srcObject as MediaStream | null)?.getTracks().length ?? 0,
            ),
        )
        .toBe(2);
      await page
        .locator(".sharing-banner")
        .getByRole("button", { name: "停止共享" })
        .click();
      await expect(viewer.locator(".video-label")).toHaveCount(0);
      await expect(viewer.locator("video")).toHaveCount(1);
      await expect(
        page.getByRole("button", { name: "全屏画面", exact: true }),
      ).toBeVisible();
    }
  } finally {
    await lateContext.close();
    await context.close();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "离开房间", exact: true }).click();
  }
});
