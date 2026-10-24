import { test, expect } from "@playwright/test";
import { registerTestAccount } from "./helpers/account";

test("an unsupported application uses device audio with explicit compatibility warnings", async ({
  page,
}) => {
  await page.goto("/");
  await registerTestAccount(page, "声音兼容回退");
  await page.getByRole("button", { name: "创建私人房间", exact: true }).click();
  await page.getByLabel("房间名称").fill("声音兼容回退");
  await page.getByRole("button", { name: "创建并进入" }).click();
  await page.evaluate(() => {
    Object.assign(window, {
      desktop: {
        platform: "win32",
        sources: async () => [
          {
            id: "screen:0:0",
            name: "屏幕",
            kind: "screen",
            thumbnail: "",
            audioIsolationSupported: true,
          },
          {
            id: "window:2:0",
            name: "设备声音兼容窗口",
            kind: "window",
            thumbnail: "",
            audioIsolationSupported: false,
          },
        ],
        selectSource: async () => {},
        cancelCapture: async () => {},
        setSharing: async () => {},
        processAudio: {
          start: async () => {
            return { sessionId: "compatibility-session", mode: "device" };
          },
          stop: async () => {},
          onData: () => () => {},
          onError: () => () => {},
          acknowledge: () => {},
        },
      },
    });
    navigator.mediaDevices.getDisplayMedia = async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 320;
      canvas.height = 180;
      canvas.getContext("2d")!.fillRect(0, 0, 320, 180);
      return canvas.captureStream(15);
    };
  });
  await page.getByRole("button", { name: "选择屏幕开始共享" }).click();
  await page
    .getByRole("checkbox", { name: "共享系统声音（排除映聚）", exact: true })
    .check();
  await page.getByRole("tab", { name: "应用窗口", exact: true }).click();
  const audio = page.getByRole("checkbox", {
    name: "共享设备声音（兼容模式）",
    exact: true,
  });
  await expect(audio).toBeEnabled();
  await expect(audio).toBeChecked();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "其他应用和映聚语音",
  );
  await page.getByRole("button", { name: "确认共享", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "停止共享", exact: true }).last(),
  ).toBeVisible();
  await expect(page.locator(".audio-compatibility-alert")).toContainText(
    "可能产生回声",
  );
  await expect(
    page.locator(".ant-notification").getByRole("alert"),
  ).toContainText("设备音频兼容模式");
  await page.setViewportSize({ width: 980, height: 680 });
  expect(
    await page
      .locator(".room-page")
      .evaluate((el) => el.scrollHeight <= el.clientHeight),
  ).toBe(true);
  await page
    .getByRole("button", { name: "停止共享", exact: true })
    .last()
    .click();
  await expect(page.locator(".audio-compatibility-alert")).toHaveCount(0);
  await page.getByRole("button", { name: "离开房间", exact: true }).click();
});

for (const mode of ["isolated", "device"] as const) {
  test(`Windows ${mode} PCM reaches the other client as shared audio and stops on capture failure`, async ({
    page,
    browser,
  }) => {
    const context = await browser.newContext({ permissions: ["microphone"] });
    const viewer = await context.newPage();
    try {
      await page.goto("/");
      await registerTestAccount(page, "应用声音共享");
      await page
        .getByRole("button", { name: "创建私人房间", exact: true })
        .click();
      await page.getByLabel("房间名称").fill("Windows 声音传输回归");
      await page.getByRole("button", { name: "创建并进入" }).click();
      await page.getByRole("button", { name: "邀请朋友", exact: true }).click();
      const invitation = await page.getByLabel("房间邀请").inputValue();
      await page.getByRole("button", { name: "关闭对话框" }).click();
      await viewer.goto("/");
      await registerTestAccount(viewer, "应用声音观众");
      await viewer
        .getByRole("button", { name: "加入房间", exact: true })
        .click();
      await viewer.getByLabel("房间号或邀请链接").fill(invitation);
      await viewer
        .getByRole("button", { name: "进入房间", exact: true })
        .click();
      await expect(page.locator(".member")).toHaveCount(2);
      await page.evaluate((mode) => {
        let data:
          | ((
              packet: import("@cinegather/contracts").ProcessAudioPacket,
            ) => void)
          | undefined;
        let error: ((id: string, message: string) => void) | undefined;
        let timer: ReturnType<typeof setInterval> | undefined;
        const host = {
          acknowledgements: 0,
          stops: 0,
          fail: () => error?.("controlled-session", "受控应用声音采集中断"),
        };
        Object.assign(window, {
          audioHost: host,
          desktop: {
            platform: "win32",
            sources: async () => [
              {
                id: "window:123:0",
                name: "受控音画窗口",
                kind: "window",
                thumbnail: "",
                audioIsolationSupported: true,
              },
            ],
            selectSource: async () => {},
            cancelCapture: async () => {},
            setSharing: async () => {},
            processAudio: {
              start: async () => {
                let sequence = 0,
                  frame = 0;
                timer = setInterval(() => {
                  const pcm = new Int16Array(960);
                  for (let i = 0; i < 480; ++i, ++frame) {
                    pcm[i * 2] = Math.round(
                      Math.sin((frame * Math.PI * 2 * 697) / 48000) * 12000,
                    );
                    pcm[i * 2 + 1] = pcm[i * 2]!;
                  }
                  data?.({
                    sessionId: "controlled-session",
                    sequence: ++sequence,
                    data: new Uint8Array(pcm.buffer),
                    timestampMs: frame / 48,
                  });
                }, 10);
                return { sessionId: "controlled-session", mode };
              },
              stop: async () => {
                ++host.stops;
                clearInterval(timer);
              },
              acknowledge: () => {
                ++host.acknowledgements;
              },
              onData: (callback: typeof data) => {
                data = callback;
                return () => {
                  data = undefined;
                };
              },
              onError: (callback: typeof error) => {
                error = callback;
                return () => {
                  error = undefined;
                };
              },
            },
          },
        });
        navigator.mediaDevices.getDisplayMedia = async () => {
          const canvas = document.createElement("canvas");
          canvas.width = 640;
          canvas.height = 360;
          const ctx = canvas.getContext("2d")!;
          ctx.fillStyle = "#7e69c4";
          ctx.fillRect(0, 0, 640, 360);
          const stream = canvas.captureStream(15);
          const frames = setInterval(() => {
            ctx.fillStyle = "white";
            ctx.fillRect(Math.random() * 500, 100, 20, 20);
          }, 66);
          stream
            .getVideoTracks()[0]!
            .addEventListener("ended", () => clearInterval(frames));
          return stream;
        };
      }, mode);
      await page.getByRole("button", { name: "选择屏幕开始共享" }).click();
      await page.getByRole("tab", { name: "应用窗口", exact: true }).click();
      await page
        .getByRole("checkbox", { name: "共享此应用的声音", exact: true })
        .check();
      await page.getByRole("button", { name: "确认共享", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "停止共享", exact: true }).last(),
      ).toBeVisible();
      if (mode === "device") {
        await expect(page.locator(".audio-compatibility-alert")).toContainText(
          "其他应用和映聚语音",
        );
        await expect(
          page.locator(".ant-notification").getByRole("alert"),
        ).toContainText("设备音频兼容模式");
      } else
        await expect(page.locator(".audio-compatibility-alert")).toHaveCount(0);
      await expect
        .poll(() =>
          viewer
            .locator("video")
            .evaluateAll((elements) =>
              elements.some((el) =>
                ((el as HTMLVideoElement).srcObject as MediaStream | null)
                  ?.getAudioTracks()
                  .some((track) => track.readyState === "live"),
              ),
            ),
        )
        .toBe(true);
      const energy = await viewer
        .locator("video")
        .first()
        .evaluate(async (video: HTMLVideoElement) => {
          const context = new AudioContext();
          await context.resume();
          const track = (video.srcObject as MediaStream).getAudioTracks()[0]!;
          const source = context.createMediaStreamSource(
            new MediaStream([track]),
          );
          const analyser = context.createAnalyser();
          source.connect(analyser);
          const data = new Float32Array(analyser.fftSize);
          let peak = 0;
          for (let i = 0; i < 30; ++i) {
            await new Promise((resolve) => setTimeout(resolve, 50));
            analyser.getFloatTimeDomainData(data);
            peak = Math.max(peak, ...data.map(Math.abs));
          }
          source.disconnect();
          await context.close();
          return peak;
        });
      expect(energy).toBeGreaterThan(0.05);
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (window as unknown as { audioHost: { acknowledgements: number } })
                .audioHost.acknowledgements,
          ),
        )
        .toBeGreaterThan(10);
      await page.evaluate(() =>
        (window as unknown as { audioHost: { fail(): void } }).audioHost.fail(),
      );
      await expect(
        page
          .locator(".ant-notification")
          .getByRole("alert")
          .filter({ hasText: "受控应用声音采集中断" }),
      ).toContainText("受控应用声音采集中断");
      await expect(
        page.getByRole("button", { name: "选择屏幕开始共享" }),
      ).toBeVisible();
      await expect(page.locator(".audio-compatibility-alert")).toHaveCount(0);
      await expect
        .poll(() =>
          viewer
            .locator("video")
            .evaluateAll((elements) =>
              elements.some((el) =>
                ((el as HTMLVideoElement).srcObject as MediaStream | null)
                  ?.getAudioTracks()
                  .some((track) => track.readyState === "live"),
              ),
            ),
        )
        .toBe(false);
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (window as unknown as { audioHost: { stops: number } }).audioHost
                .stops,
          ),
        )
        .toBeGreaterThan(0);
      await page.getByRole("button", { name: "离开房间", exact: true }).click();
      await viewer
        .getByRole("button", { name: "离开房间", exact: true })
        .click();
    } finally {
      await context.close();
    }
  });
}
