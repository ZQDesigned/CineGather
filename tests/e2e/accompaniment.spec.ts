import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { resolve, join } from "node:path";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { registerTestAccount } from "./helpers/account";
async function levels(page: Page) {
  return page.evaluate(async () => {
    const element = document.querySelector<HTMLAudioElement>(
      'audio[data-cinegather-purpose="accompaniment"]',
    );
    if (!(element?.srcObject instanceof MediaStream))
      throw new Error("No accompaniment stream");
    const context = new AudioContext({ sampleRate: 48000 });
    const input = context.createMediaStreamSource(element.srcObject);
    const analyser = context.createAnalyser();
    analyser.fftSize = 32768;
    const mute = context.createGain();
    mute.gain.value = 0;
    input.connect(analyser).connect(mute).connect(context.destination);
    await context.resume();
    await new Promise((resolve) => setTimeout(resolve, 750));
    const samples = new Float32Array(32768);
    analyser.getFloatTimeDomainData(samples);
    const db = (frequency: number) => {
      let real = 0,
        imag = 0;
      for (let i = 0; i < samples.length; i++) {
        const angle = (2 * Math.PI * frequency * i) / context.sampleRate;
        real += samples[i]! * Math.cos(angle);
        imag -= samples[i]! * Math.sin(angle);
      }
      return (
        20 *
        Math.log10(
          Math.max(1e-9, (2 * Math.hypot(real, imag)) / samples.length),
        )
      );
    };
    const result = { music: db(530), other: db(1370) };
    input.disconnect();
    analyser.disconnect();
    mute.disconnect();
    await context.close();
    return result;
  });
}
test("Mac application accompaniment is isolated, attenuated, independent of microphone and viewing, and stops at share-start/leave", async ({
  browser,
}) => {
  test.skip(
    process.platform !== "darwin" ||
      process.env.CINEGATHER_ACCOMPANIMENT_TEST !== "1",
    "Opt-in real Mac application audio test at 1% speaker volume",
  );
  test.setTimeout(180000);
  const work = await mkdtemp(join(tmpdir(), "cg-accompaniment-"));
  const sources: ChildProcess[] = [];
  let app: ElectronApplication | undefined;
  let sender: Page | undefined;
  const receiver = await browser.newContext({ permissions: ["microphone"] });
  const page = await receiver.newPage();
  const report: Record<string, unknown> = {};
  try {
    for (const [name, frequency] of [
      ["Music", "530"],
      ["Other", "1370"],
    ]) {
      const contents = resolve(
        `.local/accompaniment/CGTest${name}.app/Contents`,
      );
      await mkdir(join(contents, "MacOS"), { recursive: true });
      await writeFile(
        join(contents, "Info.plist"),
        `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>city.cinegather.fixture.${name!.toLowerCase()}</string><key>CFBundleName</key><string>CG Test ${name}</string><key>CFBundleExecutable</key><string>AudioSource</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>`,
      );
      execFileSync(
        "clang++",
        [
          "-std=c++17",
          "-fobjc-arc",
          resolve("tests/fixtures/native-audio-source.mm"),
          "-framework",
          "AppKit",
          "-framework",
          "AVFoundation",
          "-o",
          join(contents, "MacOS/AudioSource"),
        ],
        { stdio: "pipe" },
      );
      execFileSync(
        "codesign",
        ["--force", "--sign", "-", resolve(contents, "..")],
        { stdio: "pipe" },
      );
      const child = spawn(join(contents, "MacOS/AudioSource"), [frequency!], {
        stdio: "pipe",
      });
      child.stderr?.resume();
      sources.push(child);
    }
    app = await electron.launch({
      args: [
        resolve("apps/desktop/out/main/index.cjs"),
        `--user-data-dir=${work}`,
        "--autoplay-policy=no-user-gesture-required",
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
      ],
    });
    sender = await app.firstWindow();
    await registerTestAccount(sender, "伴奏发布测试");
    await sender
      .getByRole("button", { name: "创建私人房间", exact: true })
      .click();
    await sender.getByLabel("房间名称").fill("应用伴奏本机验证");
    await sender
      .getByRole("button", { name: "创建并进入", exact: true })
      .click();
    await expect(sender.locator(".connection")).toContainText("已连接");
    await sender
      .getByRole("button", { name: "关闭麦克风", exact: true })
      .click();
    const code = (
      await sender
        .getByRole("button", { name: "复制房间号", exact: true })
        .innerText()
    ).trim();
    await page.goto("/");
    await registerTestAccount(page, "伴奏收听测试");
    await page.getByRole("button", { name: "加入房间", exact: true }).click();
    await page.getByLabel("房间号或邀请链接").fill(code);
    await page.getByRole("button", { name: "进入房间", exact: true }).click();
    await expect(page.locator(".connection")).toContainText("已连接");
    const start = async () => {
      await sender!
        .getByRole("button", { name: "应用伴奏", exact: true })
        .click();
      await sender!.getByRole("combobox", { name: "伴奏来源" }).click();
      await sender!
        .getByRole("option", { name: "CG Test Music", exact: true })
        .click();
      await sender!
        .getByRole("button", { name: "开启伴奏", exact: true })
        .click();
      await expect(
        sender!.getByRole("button", { name: "应用伴奏", exact: true }),
      ).toContainText("伴奏中");
      await sender!
        .getByRole("button", { name: "应用伴奏", exact: true })
        .click();
      await expect(
        page.locator('audio[data-cinegather-purpose="accompaniment"]'),
      ).toHaveCount(1);
    };
    await start();
    await expect(
      page
        .locator(".member")
        .filter({ hasText: "伴奏发布测试" })
        .getByRole("img", { name: "正在播放伴奏", exact: true }),
    ).toBeVisible();
    await expect(
      page.locator(".member").filter({ hasText: "伴奏发布测试" }),
    ).toContainText("麦克风已关闭");
    await expect(
      page.locator(".member").filter({ hasText: "伴奏发布测试" }),
    ).not.toHaveClass(/speaking/);
    const overlay = app.windows().find((p) => p.url().includes("overlay"));
    if (overlay) {
      await expect(
        overlay.getByLabel("正在播放伴奏", { exact: true }),
      ).toHaveCount(1);
      await expect(
        overlay.getByLabel("麦克风已关闭", { exact: true }),
      ).toHaveCount(1);
    }
    const quiet = await levels(page);
    report.default20 = quiet;
    console.log("default20", quiet);
    expect(quiet.music).toBeGreaterThan(-45);
    expect(quiet.music - quiet.other).toBeGreaterThan(45);
    expect(
      await sender
        .locator('audio[data-cinegather-purpose="accompaniment"]')
        .count(),
    ).toBe(0);
    await expect(
      sender.getByRole("button", { name: "开启麦克风", exact: true }),
    ).toBeVisible();
    // Real microphone lifecycle must leave the independent track untouched.
    await sender
      .getByRole("button", { name: "开启麦克风", exact: true })
      .click();
    await expect(
      sender.getByRole("button", { name: "关闭麦克风", exact: true }),
    ).toBeVisible();
    await sender
      .getByRole("button", { name: "关闭麦克风", exact: true })
      .click();
    await expect(
      sender.getByRole("button", { name: "应用伴奏", exact: true }),
    ).toContainText("伴奏中");
    await sender.getByRole("button", { name: "应用伴奏", exact: true }).click();
    await sender.getByRole("slider", { name: "伴奏音量" }).focus();
    await sender.keyboard.press("End");
    await sender.getByRole("button", { name: "应用伴奏", exact: true }).click();
    const loud = await levels(page);
    report.full100 = loud;
    console.log("full100", loud);
    expect(loud.music - quiet.music).toBeGreaterThan(11);
    expect(loud.music - quiet.music).toBeLessThan(17);
    // A native screen publication stops only our existing accompaniment once.
    await sender
      .getByRole("button", { name: "选择屏幕开始共享", exact: true })
      .click();
    await sender.getByRole("tab", { name: "应用窗口", exact: true }).click();
    await sender
      .locator(".source-card")
      .filter({ hasText: "CG Controlled Audio 530" })
      .getByRole("radio")
      .check();
    await sender.getByRole("button", { name: "确认共享", exact: true }).click();
    await expect(sender.locator(".sharing-banner")).toBeVisible({
      timeout: 20000,
    });
    await expect(
      sender.getByRole("button", { name: "应用伴奏", exact: true }),
    ).toHaveAttribute("aria-pressed", "false");
    await expect(
      page.locator('audio[data-cinegather-purpose="accompaniment"]'),
    ).toHaveCount(0);
    await start();
    report.restartedDuringShare = await levels(page);
    await expect(
      page.getByRole("button", { name: "加入观看", exact: true }),
    ).toBeVisible();
    await sender
      .locator(".sharing-banner")
      .getByRole("button", { name: "停止共享", exact: true })
      .click();
    await expect(
      sender.getByRole("button", { name: "应用伴奏", exact: true }),
    ).toContainText("伴奏中");
    await expect(
      sender.getByRole("button", { name: "共享屏幕", exact: true }),
    ).toBeVisible();
    await page.evaluate(() => {
      navigator.mediaDevices.getDisplayMedia = async () => {
        const canvas = document.createElement("canvas");
        canvas.width = 640;
        canvas.height = 360;
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = "#6456a2";
        ctx.fillRect(0, 0, 640, 360);
        return canvas.captureStream(15);
      };
    });
    await page
      .getByRole("button", { name: "选择屏幕开始共享", exact: true })
      .click();
    await page.getByRole("button", { name: "选择并共享", exact: true }).click();
    await expect(page.locator(".sharing-banner")).toBeVisible();
    await expect(
      sender.getByRole("button", { name: "应用伴奏", exact: true }),
    ).toContainText("伴奏中");
    report.remoteShareDoesNotStopAccompaniment = await levels(page);
    await page
      .locator(".sharing-banner")
      .getByRole("button", { name: "停止共享", exact: true })
      .click();
    await sender.screenshot({ path: resolve(".local/accompaniment/room.png") });
    // The room owner can mute and revoke accompaniment through existing voice policy.
    await sender
      .getByRole("button", { name: "伴奏收听测试的成员操作", exact: true })
      .click();
    await sender
      .getByRole("menuitem", { name: "转移房主", exact: true })
      .click();
    await sender.getByRole("button", { name: "确认转移", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "房间设置", exact: true }),
    ).toBeVisible();
    await sender
      .getByRole("button", { name: "开启麦克风", exact: true })
      .click();
    await expect(
      sender.getByRole("button", { name: "关闭麦克风", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "伴奏发布测试的成员操作", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "关闭伴奏", exact: true }).click();
    await expect(
      sender.getByRole("button", { name: "应用伴奏", exact: true }),
    ).toHaveAttribute("aria-pressed", "false");
    await expect(
      page.locator('audio[data-cinegather-purpose="accompaniment"]'),
    ).toHaveCount(0);
    await expect(
      sender.getByRole("button", { name: "关闭麦克风", exact: true }),
    ).toBeVisible();
    await expect(
      sender.getByText("房主已关闭你的伴奏", { exact: true }),
    ).toBeVisible();
    await start();
    await page
      .getByRole("button", { name: "伴奏发布测试的成员操作", exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: "关闭麦克风", exact: true })
      .click();
    await expect(
      sender.getByRole("button", { name: "开启麦克风", exact: true }),
    ).toBeVisible();
    await expect(
      sender.getByRole("button", { name: "应用伴奏", exact: true }),
    ).toContainText("伴奏中");

    await page
      .getByRole("button", { name: "伴奏发布测试的成员操作", exact: true })
      .click();
    await page
      .getByRole("menuitemcheckbox", { name: "禁止开麦", exact: true })
      .click();
    await expect(
      sender.getByRole("button", { name: "应用伴奏", exact: true }),
    ).toBeDisabled();
    await expect(
      page.locator('audio[data-cinegather-purpose="accompaniment"]'),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "伴奏发布测试的成员操作", exact: true })
      .click();
    await page
      .getByRole("menuitemcheckbox", { name: "禁止开麦", exact: true })
      .click();
    await expect(
      sender.getByRole("button", { name: "应用伴奏", exact: true }),
    ).toBeEnabled();
    await start();
    report.moderation = "passed";

    await sender.getByRole("button", { name: "离开房间", exact: true }).click();
    await expect(
      page.locator('audio[data-cinegather-purpose="accompaniment"]'),
    ).toHaveCount(0);
    report.lifecycle = "passed";
    await writeFile(
      resolve(".local/accompaniment/room-audio.json"),
      JSON.stringify(report, null, 2),
    );
  } finally {
    await writeFile(
      resolve(".local/accompaniment/room-audio-progress.json"),
      JSON.stringify(report, null, 2),
    );
    for (const p of [sender, page])
      if (p && !p.isClosed()) {
        const leave = p.getByRole("button", { name: "离开房间", exact: true });
        if (await leave.count()) await leave.click().catch(() => {});
      }
    await app?.close();
    await receiver.close();
    for (const source of sources) source.kill();
    await rm(work, { recursive: true, force: true });
  }
});
