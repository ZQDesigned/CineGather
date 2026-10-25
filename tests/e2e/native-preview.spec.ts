import { test, expect } from "@playwright/test";
import { registerTestAccount } from "./helpers/account";
declare global {
  interface Window {
    previewProbe: { mode: string; calls: number; release?: () => void };
  }
}

test("native sharer sees local changing frames without joining the server stream or enabling fullscreen", async ({
  page,
}) => {
  await page.goto("/");
  await registerTestAccount(page, "本地预览回归");
  await page.getByRole("button", { name: "创建私人房间", exact: true }).click();
  await page.getByLabel("房间名称").fill("本地原生预览");
  await page.getByRole("button", { name: "创建并进入", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "选择屏幕开始共享" }),
  ).toBeEnabled();
  await page.evaluate(async () => {
    const module = "/store.ts";
    const { update, state } = await import(module);
    const canvas = document.createElement("canvas");
    canvas.width = 960;
    canvas.height = 540;
    const frame = (color: string) => {
      const context = canvas.getContext("2d")!;
      context.fillStyle = color;
      context.fillRect(0, 0, 960, 540);
      return { image: canvas.toDataURL("image/jpeg"), width: 960, height: 540 };
    };
    const probe = {
      calls: 0,
      mode: "blue",
      blue: frame("#1677ff"),
      red: frame("#ff3322"),
      release: undefined as (() => void) | undefined,
    };
    Object.assign(window, { previewProbe: probe });
    Object.assign(window, {
      desktop: {
        platform: "win32",
        nativeCapture: true,
        capturePreview: async () => {
          probe.calls++;
          if (probe.mode === "late")
            await new Promise<void>((resolve) => {
              probe.release = resolve;
            });
          if (probe.mode === "error") throw new Error("preview-unavailable");
          return probe.mode === "blue" ? probe.blue : probe.red;
        },
      },
    });
    update({
      shareState: "active",
      media: {
        ...state().media,
        watching: false,
        sharer: {
          id: state().user.id,
          name: "本地预览回归",
          local: true,
          hasVideo: false,
        },
      },
    });
  });
  const preview = page.getByRole("img", { name: "本地共享预览" });
  await expect(preview).toBeVisible();
  const first = await preview.getAttribute("src");
  await page.evaluate(() => {
    window.previewProbe.mode = "red";
  });
  await expect.poll(() => preview.getAttribute("src")).not.toBe(first);
  await expect(
    page.getByRole("button", { name: "全屏画面", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "加入观看", exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(async () => {
      const module = "/store.ts";
      return (await import(module)).state().media.watching;
    }),
  ).toBe(false);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const calls = await page.evaluate(() => window.previewProbe.calls);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.previewProbe.calls)).toBe(calls);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect
    .poll(() => page.evaluate(() => window.previewProbe.calls))
    .toBeGreaterThan(calls);
  await page.evaluate(() => {
    window.previewProbe.mode = "error";
  });
  await expect(preview).toHaveCount(0);
  await expect(page.getByText("本地预览暂不可用")).toBeVisible();
  await page.evaluate(() => {
    window.previewProbe.mode = "late";
  });
  await expect
    .poll(() => page.evaluate(() => Boolean(window.previewProbe.release)))
    .toBe(true);
  await page.evaluate(async () => {
    const module = "/store.ts";
    const { update, state } = await import(module);
    update({
      shareState: "idle",
      media: { ...state().media, sharer: undefined },
    });
  });
  await page.evaluate(() => {
    window.previewProbe.release!();
  });
  await expect(preview).toHaveCount(0);
  await expect(page.getByText("好戏，等你开场")).toBeVisible();
});
