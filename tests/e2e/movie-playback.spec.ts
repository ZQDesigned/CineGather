import { registerTestAccount } from "./helpers/account";
import { test, expect, type Page } from "@playwright/test";
async function guest(page: Page, name: string) {
  await page.goto("/");
  await registerTestAccount(page, name);
  await expect(
    page.getByRole("heading", { name: `晚上好，${name}` }),
  ).toBeVisible();
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
  try {
    await guest(viewer, "同步接收者");
    await viewer.getByRole("button", { name: "加入房间", exact: true }).click();
    await viewer.getByLabel("房间号或邀请链接").fill(invite);
    await viewer.getByRole("button", { name: "进入房间", exact: true }).click();
    await expect(
      viewer.getByRole("button", { name: "关闭麦克风", exact: true }),
    ).toBeEnabled();
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
      await expect(viewer.locator(".video-label")).toContainText("含共享声音");
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
    await context.close();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "离开房间", exact: true }).click();
  }
});
