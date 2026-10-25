import { test, expect } from "@playwright/test";
import { registerTestAccount } from "./helpers/account";
import { NativeProtocol } from "../../apps/desktop/src/main/native-protocol";
import type { NativePreviewOffer } from "@cinegather/contracts";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";

declare global {
  interface Window {
    cgPreviewStart(id: string): Promise<NativePreviewOffer | null>;
    cgPreviewAnswer(id: string, sdp: string): Promise<boolean>;
    cgPreviewStop(id: string): Promise<void>;
    cgPreviewForeground(active: boolean): Promise<void>;
    previewProbe: { setForeground: (active: boolean) => Promise<void> };
  }
}
const windows = process.platform === "win32";
const fixture = resolve(
  windows
    ? ".local/native-runtime/windows/build/CGStreamPreviewSmoke.exe"
    : ".local/native-stream-preview/stream-preview",
);
const receiverPath = resolve(
  windows
    ? ".local/pion-whip-smoke.exe"
    : ".local/native-stream-preview/pion-receiver",
);
const runtime = resolve(
  windows
    ? ".local/native-runtime/windows/obs"
    : ".local/native-stream-preview/Contents",
);

test("native quality preview releases the decoder on blur, lobby navigation and unmount, without stopping publication", async ({
  page,
}) => {
  test.skip(
    !existsSync(fixture) || !existsSync(receiverPath),
    "Requires the native OBS integration fixture; the Windows package job builds and exercises it.",
  );
  test.setTimeout(90000);
  const receiver = spawn(receiverPath, [], {
    stdio: "pipe",
    windowsHide: true,
  });
  receiver.stderr.resume();
  const port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("receiver-timeout")),
      10000,
    );
    createInterface({ input: receiver.stdout }).once("line", (line) => {
      clearTimeout(timer);
      resolve(JSON.parse(line).port);
    });
    receiver.on("error", reject);
  });
  const child = spawn(
    fixture,
    [runtime, "30", `http://127.0.0.1:${port}/whip`],
    {
      stdio: "pipe",
      windowsHide: true,
      env: {
        ...process.env,
        ...(windows
          ? { PATH: join(runtime, "bin/64bit") + delimiter + process.env.PATH }
          : {}),
      },
    },
  );
  const pipe = new NativeProtocol(
    (data) => child.stdin.write(data),
    () => child.kill(),
  );
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (data) => pipe.receive(data));
  child.stderr.resume();
  child.on("error", (error) => pipe.close(error));
  child.stdin.on("error", () => pipe.close());
  child.on("close", () => pipe.close());
  let active = true,
    current: string | undefined,
    starts = 0;
  let holdNext = false,
    releaseOld: (() => void) | undefined,
    failNext = false;
  try {
    await expect
      .poll(
        async () =>
          (await pipe.call<{ frames: number }>({ type: "status" })).frames,
      )
      .toBeGreaterThan(20);
    await page.exposeFunction("cgPreviewStart", async (id: string) => {
      if (!active) return null;
      current = id;
      starts++;
      if (holdNext) {
        holdNext = false;
        await new Promise<void>((resolve) => {
          releaseOld = resolve;
        });
      }
      if (current !== id || !active) return null;
      if (failNext) {
        failNext = false;
        return null;
      }
      const { sdp } = await pipe.call<{ sdp: string }>({ type: "offer" });
      return current === id && active ? { id, sdp } : null;
    });
    await page.exposeFunction(
      "cgPreviewAnswer",
      async (id: string, sdp: string) => {
        if (current !== id || !active) return false;
        await pipe.call({ type: "answer", sdp });
        return current === id && active;
      },
    );
    await page.exposeFunction("cgPreviewStop", async (id: string) => {
      if (current !== id) return;
      current = undefined;
      await pipe.call({ type: "pause" });
    });
    await page.exposeFunction("cgPreviewForeground", async (value: boolean) => {
      active = value;
      if (!active) {
        current = undefined;
        await pipe.call({ type: "pause" });
      }
    });
    await page.goto("/");
    await registerTestAccount(page, "原生全画质预览");
    await page
      .getByRole("button", { name: "创建私人房间", exact: true })
      .click();
    await page.getByLabel("房间名称").fill("本地原生预览");
    await page.getByRole("button", { name: "创建并进入", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "选择屏幕开始共享" }),
    ).toBeEnabled();
    await page.evaluate(async () => {
      const module = "/store.ts";
      const { update, state } = await import(module);
      let foreground = true;
      const listeners = new Set<(active: boolean) => void>();
      window.previewProbe = {
        setForeground: async (active: boolean) => {
          await window.cgPreviewForeground(active);
          foreground = active;
          listeners.forEach((callback) => callback(active));
        },
      };
      Object.assign(window, {
        desktop: {
          platform: "win32",
          nativeCapture: true,
          nativePreview: {
            start: (id: string) => window.cgPreviewStart(id),
            answer: (id: string, sdp: string) =>
              window.cgPreviewAnswer(id, sdp),
            stop: (id: string) => window.cgPreviewStop(id),
            foreground: async () => foreground,
            onForeground: (callback: (active: boolean) => void) => {
              listeners.add(callback);
              return () => listeners.delete(callback);
            },
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
            name: "原生全画质预览",
            local: true,
            hasVideo: false,
          },
        },
      });
    });
    const video = page.getByLabel("本地共享预览", { exact: true });
    await expect(video).toBeVisible({ timeout: 15000 });
    await expect
      .poll(() =>
        video.evaluate((element) => (element as HTMLVideoElement).videoWidth),
      )
      .toBe(1920);
    expect(
      await video.evaluate(
        (element) => (element as HTMLVideoElement).videoHeight,
      ),
    ).toBe(1080);
    const frames = await video.evaluate(
      (element) =>
        (element as HTMLVideoElement).getVideoPlaybackQuality()
          .totalVideoFrames,
    );
    await expect
      .poll(() =>
        video.evaluate(
          (element) =>
            (element as HTMLVideoElement).getVideoPlaybackQuality()
              .totalVideoFrames,
        ),
      )
      .toBeGreaterThan(frames + 15);
    await expect(
      page.getByRole("button", { name: "全屏画面", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "加入观看", exact: true }),
    ).toHaveCount(0);
    await page.evaluate(() => window.previewProbe.setForeground(false));
    await expect(video).toBeHidden();
    expect(
      await video.evaluate(
        (element) => (element as HTMLVideoElement).srcObject,
      ),
    ).toBeNull();
    const paused = await pipe.call<{
      frames: number;
      previewFrames: number;
      previewActive: boolean;
    }>({ type: "status" });
    expect(paused.previewActive).toBe(false);
    await page.waitForTimeout(1200);
    const after = await pipe.call<typeof paused>({ type: "status" });
    expect(after.previewFrames).toBe(paused.previewFrames);
    expect(after.frames - paused.frames).toBeGreaterThan(25);
    await page.evaluate(() => window.previewProbe.setForeground(true));
    await expect(video).toBeVisible({ timeout: 15000 });
    await page.getByRole("menuitem", { name: /^我的房间/ }).click();
    await expect(video).toBeHidden();
    await expect
      .poll(
        async () =>
          (await pipe.call<{ previewActive: boolean }>({ type: "status" }))
            .previewActive,
      )
      .toBe(false);
    await page
      .getByRole("button", { name: "进入本地原生预览", exact: true })
      .click();
    await expect(video).toBeVisible({ timeout: 15000 });
    expect(starts).toBe(3);
    await page.evaluate(() => window.previewProbe.setForeground(false));
    holdNext = true;
    await page.evaluate(() => window.previewProbe.setForeground(true));
    await expect.poll(() => Boolean(releaseOld)).toBe(true);
    await page.evaluate(() => window.previewProbe.setForeground(false));
    await page.evaluate(() => window.previewProbe.setForeground(true));
    await expect(video).toBeVisible({ timeout: 15000 });
    releaseOld!();
    await page.waitForTimeout(300);
    await expect(video).toBeVisible();
    expect(
      (await pipe.call<{ previewActive: boolean }>({ type: "status" }))
        .previewActive,
    ).toBe(true);

    expect(
      await page.evaluate(async () => {
        const module = "/store.ts";
        return (await import(module)).state().media.watching;
      }),
    ).toBe(false);
    await page.evaluate(() => window.previewProbe.setForeground(false));
    failNext = true;
    await page.evaluate(() => window.previewProbe.setForeground(true));
    await expect(page.getByText("本地预览暂不可用")).toBeVisible();
    await page.evaluate(async () => {
      const module = "/store.ts";
      const { update, state } = await import(module);
      update({
        shareState: "idle",
        media: { ...state().media, sharer: undefined },
      });
    });
    await expect(video).toBeHidden();
    await expect(page.getByText("好戏，等你开场")).toBeVisible();
    await expect
      .poll(
        async () =>
          (await pipe.call<{ previewActive: boolean }>({ type: "status" }))
            .previewActive,
      )
      .toBe(false);
    await pipe.call({ type: "shutdown" });
  } finally {
    child.kill();
    receiver.kill();
  }
});
