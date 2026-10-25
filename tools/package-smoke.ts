import { _electron as electron, expect } from "@playwright/test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { webRTCEncoderProbe } from "./encoder-probe";
import { unzipSync, strFromU8 } from "fflate";

const { version } = await Bun.file("apps/desktop/package.json").json();
const platform = process.argv[2] ?? process.platform;
if (platform !== process.platform || !["darwin", "win32"].includes(platform))
  throw new Error(
    "Run the package smoke test on its native Mac or Windows host.",
  );
const packageDirectory = resolve(process.argv[3] ?? "apps/desktop/release");
const executablePath = join(
  packageDirectory,
  platform === "win32"
    ? "win-unpacked/CineGather.exe"
    : "mac-arm64/CineGather.app/Contents/MacOS/CineGather",
);
const profile = await mkdtemp(join(tmpdir(), "cinegather-package-smoke-"));
await writeFile(
  join(profile, "settings.json"),
  JSON.stringify({
    minimizeToTray: false,
    pushToTalk: true,
    pttShortcut: "Control+Alt+Shift+F12",
    muteShortcut: "Control+Alt+Shift+M",
    quality: "cinema",
    windowsEncoder: "x264",
    inputDevice: "",
    outputDevice: "",
  }),
);
let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
try {
  app = await electron.launch({
    executablePath,
    args: [
      `--user-data-dir=${profile}`,
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
    timeout: 30000,
  });
  expect(await app.evaluate(({ app }) => app.getVersion())).toBe(version);
  const page = await app.firstWindow();
  if (platform === "win32") {
    expect(
      await app.evaluate(({ app }) =>
        app.commandLine.getSwitchValue("enable-features"),
      ),
    ).toContain("PlatformH264CbpEncoding");
    const encoding = await page.evaluate(webRTCEncoderProbe);
    expect(encoding.mimeType?.toLowerCase()).toBe("video/h264");
    expect(encoding.sdpFmtpLine).toContain("profile-level-id=42e0");
    expect(encoding.framesEncoded).toBeGreaterThanOrEqual(45);
    expect(encoding.framesDecoded).toBeGreaterThanOrEqual(45);
    console.log(
      "Packaged Windows actual H264 loopback encoder:",
      JSON.stringify(encoding),
    );
  }
  await expect(page.locator(".version")).toHaveText(`v${version}`);
  const updates = await page.evaluate(() => window.desktop!.updates!.status());
  expect(updates.mode).toBe(platform === "darwin" ? "notify" : "disabled");
  if (platform === "win32") {
    const host = join(
      packageDirectory,
      "win-unpacked/resources/capture/CGProcessAudioHost.exe",
    );
    const probe = spawnSync(host, ["window", "0", String(process.pid)], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 10000,
    });
    expect(probe.error).toBeUndefined();
    expect(probe.status).toBe(1);
    expect(probe.stderr).toContain("ERROR window");
    expect(
      await page.evaluate(async () => {
        try {
          await window.desktop!.processAudio!.start();
          return false;
        } catch {
          return true;
        }
      }),
    ).toBe(true);
    // win-unpacked is deliberately not an installed NSIS application.
    expect(updates.status).toBe("disabled");
    expect(
      await page.evaluate(async () => {
        try {
          await window.desktop!.updates!.install();
          return false;
        } catch {
          return true;
        }
      }),
    ).toBe(true);
  }
  await expect(
    page.getByRole("heading", { name: "欢迎来到映聚", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("tab", { name: "登录", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("用户名", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "访客体验", exact: true }),
  ).toHaveCount(0);
  expect(await page.evaluate(() => window.desktop!.hotkeyStatus!())).toEqual({
    error: undefined,
  });
  expect(
    (await page.evaluate(() => window.desktop!.loadSettings())).pushToTalk,
  ).toBe(true);
  expect(
    (await page.evaluate(() => window.desktop!.loadSettings())).noiseReduction,
  ).toBe("enhanced");
  await page.getByRole("menuitem", { name: "设置与设备", exact: true }).click();
  await page.getByRole("button", { name: "测试麦克风", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "停止测试", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("增强降噪暂不可用，已使用基础降噪", { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "停止测试", exact: true }).click();
  await page.getByRole("button", { name: "关闭对话框", exact: true }).click();
  const preferences = await app.evaluate(({ BrowserWindow }) => {
    const contents = BrowserWindow.getAllWindows()[0]!
      .webContents as unknown as {
      getLastWebPreferences(): {
        sandbox: boolean;
        contextIsolation: boolean;
        nodeIntegration: boolean;
      };
    };
    const { sandbox, contextIsolation, nodeIntegration } =
      contents.getLastWebPreferences();
    return { sandbox, contextIsolation, nodeIntegration };
  });
  expect(preferences).toEqual({
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
  });
  // Exercise the real packaged (asar) diagnostic ZIP path, including its compressor worker.
  const diagnosticPath = join(profile, "diagnostics.zip");
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, diagnosticPath);
  expect(
    await page.evaluate(() =>
      window.desktop!.exportDiagnostics({
        state: "disconnected",
        token: "package-smoke-secret",
      }),
    ),
  ).toBe(true);
  const diagnosticFiles = unzipSync(await readFile(diagnosticPath));
  const manifest = JSON.parse(strFromU8(diagnosticFiles["manifest.json"]!));
  expect(manifest.platform).toBe(platform);
  expect(manifest.encodingPolicy).toMatchObject({
    constrainedBaselineHardwareEnabled: platform === "win32",
    gpuBlocklistRespected: true,
    softwareFallbackAllowed: true,
  });
  if (platform === "win32") {
    expect(
      manifest.nativeEncoder.inventory.encoders.some(
        (e: { id: string }) => e.id === "x264",
      ),
    ).toBe(true);
    expect(manifest.nativeEncoder.probe.status).toBe("ok");
    expect(manifest.nativeEncoder.probe.encoder.selectedEncoder).toBe("x264");
  }
  expect(strFromU8(diagnosticFiles["timeline.ndjson"]!)).toContain(
    '"resources"',
  );
  expect(strFromU8(diagnosticFiles["current.json"]!)).not.toContain(
    "package-smoke-secret",
  );
  // Verify the packaged overlay preload/assets in the same sandbox used by releases.
  if (platform === "darwin")
    expect(await app.evaluate(({ app }) => app.dock!.isVisible())).toBe(true);
  const overlayOpened = app.waitForEvent("window", {
    predicate: (p) => p !== page,
  });
  await page.evaluate(() =>
    window.desktop!.memberOverlay!.publish({
      roomId: "package-smoke",
      roomName: "成员浮层验证",
      members: [
        {
          id: "local",
          name: "测试成员",
          local: true,
          owner: true,
          microphone: false,
          speaking: false,
          sharing: false,
        },
      ],
    }),
  );
  const overlay = await overlayOpened;
  await expect(overlay.getByText("测试成员", { exact: true })).toBeVisible();
  if (platform === "darwin")
    expect(await app.evaluate(({ app }) => app.dock!.isVisible())).toBe(true);
  expect(await overlay.evaluate(() => window.desktop)).toBeUndefined();
  expect(
    await overlay.evaluate(() => localStorage.getItem("cinegather.session")),
  ).toBeNull();
  await expect
    .poll(() =>
      app!.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows().find(
          (w) => w.getTitle() === "映聚成员浮层",
        );
        return Boolean(
          window?.isVisible() &&
            window.isAlwaysOnTop() &&
            !window.isFocusable(),
        );
      }),
    )
    .toBe(true);
  expect(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.getTitle() === "映聚成员浮层")!
        .getOpacity(),
    ),
  ).toBe(1);
  // Windows capture exclusion also blocks some desktop recording tools (e.g. Instant Replay).
  expect(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.getTitle() === "映聚成员浮层")!
        .isContentProtected(),
    ),
  ).toBe(false);
  if (platform === "win32") {
    const overlaySource = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.getTitle() === "映聚成员浮层")!
        .getMediaSourceId(),
    );
    const sources = await page.evaluate(() => window.desktop!.sources());
    expect(sources.some((source) => source.id === overlaySource)).toBe(false);
  }
  await expect(overlay.locator("section")).toHaveCSS(
    "background-color",
    "rgba(21, 24, 32, 0.85)",
  );
  await expect(overlay.getByRole("button")).toHaveCount(0);
  await page.evaluate(() => window.desktop!.memberOverlay!.publish(null));
  await expect
    .poll(() =>
      app!.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().some(
          (w) => w.getTitle() === "映聚成员浮层" && w.isVisible(),
        ),
      ),
    )
    .toBe(false);
  console.log(
    `Native ${platform} package boot, RNNoise assets/microphone test, sandbox, isolated member overlay, N-API loading and global hotkey registration passed; physical key behavior is a separate test.`,
  );
} finally {
  if (app) await app.close();
  await rm(profile, { recursive: true, force: true });
}
