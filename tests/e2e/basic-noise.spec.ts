import type { MicrophoneDenoiser } from "../../packages/media-core/src/noise-processor";
import type { MicrophoneNoiseStatus } from "../../packages/media-core/src/noise";
import { test, expect } from "@playwright/test";
import { writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { selectAccountMenu } from "./helpers/account-menu";
import { benchmarkBasicNoise } from "./helpers/noise-benchmark";

test("basic mode runs its own light neural filter and suppresses fan and key noise without losing quiet speech", async ({
  page,
}) => {
  await page.goto("/");
  await selectAccountMenu(page, "设置与设备");
  const result = await benchmarkBasicNoise(page);
  await mkdir(".local/basic-noise", { recursive: true });
  await writeFile(
    ".local/basic-noise/quality.json",
    JSON.stringify(result, null, 2),
  );
  console.log("Basic denoising quality", result);
  expect(result.statuses.at(-1)).toMatchObject({
    requested: "basic",
    active: "basic",
    engine: "rnnoise",
  });
  expect(result.filterSampleRate).toBe(48000);
  expect(result.callerSampleRate).toBe(44100);
  expect(result.attenuationDb).toBeGreaterThan(8);
  expect(result.improvementDb).toBeGreaterThan(3);
  expect(result.speechGain).toBeGreaterThan(0.5);
  expect(result.speechGain).toBeLessThan(2);
  expect(result.delayMs).toBeLessThan(100);
  expect(result.inputState).toBe("live");
});

test("a basic model load failure is explained in microphone settings while capture remains usable", async ({
  page,
}) => {
  await page.route("**/*.wasm*", async (route) => {
    if (route.request().resourceType() === "fetch") await route.abort("failed");
    else await route.continue();
  });
  await page.goto("/");
  await selectAccountMenu(page, "设置与设备");
  await page.getByRole("button", { name: "测试麦克风", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "停止测试", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "应用降噪暂不可用，正在使用系统兼容降噪。" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "停止测试", exact: true }).click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "应用降噪暂不可用，正在使用系统兼容降噪。" }),
  ).toHaveCount(0);
});

test("basic mode also preserves softer speech over broadband and mains-like background noise", async ({
  page,
}) => {
  await page.goto("/");
  await selectAccountMenu(page, "设置与设备");
  const result = await benchmarkBasicNoise(page, {
    broadband: true,
    voiceGain: 0.15,
  });
  await writeFile(
    ".local/basic-noise/quiet-quality.json",
    JSON.stringify(result, null, 2),
  );
  console.log("Quiet basic denoising quality", result);
  expect(result.statuses.at(-1)).toMatchObject({
    requested: "basic",
    active: "basic",
    engine: "rnnoise",
  });
  expect(result.attenuationDb).toBeGreaterThan(8);
  expect(result.improvementDb).toBeGreaterThan(3);
  expect(result.speechGain).toBeGreaterThan(0.5);
  expect(result.delayMs).toBeLessThan(100);
});

test("basic model failures are retryable without replacing or stopping the caller microphone", async ({
  page,
}) => {
  await page.route("**/*.wasm*", async (route) => {
    if (route.request().resourceType() === "fetch") await route.abort("failed");
    else await route.continue();
  });
  await page.goto("/");
  await selectAccountMenu(page, "设置与设备");
  const module =
    "/@fs" +
    (await import("node:path")).resolve(
      "packages/media-core/src/noise-processor.ts",
    );
  const first = await page.evaluate(async (module) => {
    const { MicrophoneDenoiser } = await import(module);
    const context = new AudioContext();
    await context.resume();
    const track = context
        .createMediaStreamDestination()
        .stream.getAudioTracks()[0]!,
      statuses: unknown[] = [];
    const processor = new MicrophoneDenoiser(
      (s: unknown) => statuses.push(s),
      "basic",
    );
    const probe = { context, track, processor, statuses };
    Object.assign(window, { basicNoiseProbe: probe });
    await processor.init({ kind: "audio", track, audioContext: context });
    return {
      status: statuses.at(-1),
      input: track.readyState,
      context: context.state,
    };
  }, module);
  expect(first.status).toMatchObject({
    requested: "basic",
    active: "basic",
    engine: "platform",
    reason: "rnnoise-initialization-failed",
  });
  expect(first.input).toBe("live");
  expect(first.context).toBe("running");
  await page.unroute("**/*.wasm*");
  const retried = await page.evaluate(async () => {
    const p = (
      window as unknown as {
        basicNoiseProbe: {
          context: AudioContext;
          track: MediaStreamTrack;
          processor: MicrophoneDenoiser;
          statuses: MicrophoneNoiseStatus[];
        };
      }
    ).basicNoiseProbe;
    try {
      await p.processor.restart({
        kind: "audio" as Parameters<MicrophoneDenoiser["restart"]>[0]["kind"],
        track: p.track,
        audioContext: p.context,
      });
      const status = p.statuses.at(-1);
      await p.processor.destroy();
      return { status, input: p.track.readyState, context: p.context.state };
    } finally {
      p.track.stop();
      await p.context.close();
    }
  });
  expect(retried.status).toMatchObject({
    requested: "basic",
    active: "basic",
    engine: "rnnoise",
  });
  expect(retried.input).toBe("live");
  expect(retried.context).toBe("running");
});

test("canceling basic model initialization releases owned resources without stopping the original microphone", async ({
  page,
}) => {
  let loaded!: () => void, release!: () => void;
  const loading = new Promise<void>((r) => {
      loaded = r;
    }),
    gate = new Promise<void>((r) => {
      release = r;
    });
  await page.route("**/*.wasm*", async (route) => {
    if (route.request().resourceType() === "fetch") {
      loaded();
      await gate;
    }
    await route.continue().catch(() => {});
  });
  await page.goto("/");
  await selectAccountMenu(page, "设置与设备");
  const module =
    "/@fs" +
    (await import("node:path")).resolve(
      "packages/media-core/src/noise-processor.ts",
    );
  const starting = page.evaluate(async (module) => {
    const { MicrophoneDenoiser } = await import(module);
    const context = new AudioContext();
    await context.resume();
    const track = context
        .createMediaStreamDestination()
        .stream.getAudioTracks()[0]!,
      processor = new MicrophoneDenoiser(undefined, "basic");
    Object.assign(window, { cancelNoiseProbe: { context, track, processor } });
    await processor.init({ kind: "audio", track, audioContext: context });
    return {
      output: !!processor.processedTrack,
      input: track.readyState,
      context: context.state,
    };
  }, module);
  try {
    await loading;
    await page.evaluate(async () => {
      const p = (
        window as unknown as {
          cancelNoiseProbe: { processor: MicrophoneDenoiser };
        }
      ).cancelNoiseProbe;
      await p.processor.destroy();
    });
    release();
    expect(await starting).toEqual({
      output: false,
      input: "live",
      context: "running",
    });
  } finally {
    release();
    await starting.catch(() => {});
    await page.evaluate(async () => {
      const p = (
        window as unknown as {
          cancelNoiseProbe: {
            context: AudioContext;
            track: MediaStreamTrack;
            processor: MicrophoneDenoiser;
          };
        }
      ).cancelNoiseProbe;
      await p.processor.destroy();
      p.track.stop();
      await p.context.close();
    });
  }
});

test("room microphone controls retain the real fallback status and its warning through closing animation", async ({
  page,
}) => {
  const { registerTestAccount } = await import("./helpers/account");
  await page.route("**/*.wasm*", async (route) => {
    if (route.request().resourceType() === "fetch") await route.abort("failed");
    else await route.continue();
  });
  await page.goto("/");
  await registerTestAccount(page, "基础降噪回退验证");
  const userId = await page.evaluate(async () => {
    const { state } = await import("/store.ts" as string);
    return state().user.id;
  });
  await page.getByRole("button", { name: "创建私人房间", exact: true }).click();
  await page.getByLabel("房间名称", { exact: true }).fill("基础降噪回退验证");
  await page.getByRole("button", { name: "创建并进入", exact: true }).click();
  try {
    await expect(
      page.getByRole("button", { name: "关闭麦克风", exact: true }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: "音频快捷设置", exact: true })
      .click();
    const panel = page.getByRole("region", {
      name: "音频快捷设置",
      exact: true,
    });
    await expect(panel.getByRole("alert")).toContainText(
      "应用降噪暂不可用，正在使用系统兼容降噪。",
    );
    await panel.evaluate(async (el) => {
      await Promise.all(
        el
          .closest(".ant-popover")!
          .getAnimations({ subtree: true })
          .map((a) => a.finished.catch(() => {})),
      );
    });
    const handle = (await panel.elementHandle())!,
      text = await handle.textContent();
    await panel.evaluate((el) => {
      const root = el.closest(".ant-popover")!;
      Object.assign(window, { noisePanelExiting: false });
      document.addEventListener(
        "animationstart",
        (event) => {
          if (event.target === root && /Out/i.test(event.animationName)) {
            (
              window as unknown as { noisePanelExiting: boolean }
            ).noisePanelExiting = true;
            root.getAnimations().forEach((a) => a.pause());
          }
        },
        { once: true },
      );
    });
    await page
      .getByRole("button", { name: "音频快捷设置", exact: true })
      .click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { noisePanelExiting: boolean })
              .noisePanelExiting,
        ),
      )
      .toBe(true);
    expect(await handle.evaluate((el) => el.isConnected)).toBe(true);
    expect(await handle.textContent()).toBe(text);
    await page.evaluate(() =>
      document
        .getAnimations()
        .filter((a) => a.playState === "paused")
        .forEach((a) => a.finish()),
    );
    await expect(panel).not.toBeVisible();
  } finally {
    await page.evaluate(async () => {
      const { roomSession } = await import("/controller.ts" as string);
      await roomSession.leave();
    });
    execFileSync(
      "bun",
      [
        "tests/e2e/helpers/cleanup-room-invitations.ts",
        JSON.stringify({ users: [userId], rooms: [] }),
      ],
      { stdio: "pipe" },
    );
  }
});
