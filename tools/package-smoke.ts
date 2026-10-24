import { _electron as electron, expect } from "@playwright/test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

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
  await expect(page.locator(".version")).toHaveText(`v${version}`);
  const updates = await page.evaluate(() => window.desktop!.updates!.status());
  expect(updates.mode).toBe(platform === "darwin" ? "notify" : "disabled");
  if (platform === "win32") {
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
  console.log(
    `Native ${platform} package boot, RNNoise assets/microphone test, sandbox, N-API loading and global hotkey registration passed; physical key behavior is a separate test.`,
  );
} finally {
  if (app) await app.close();
  await rm(profile, { recursive: true, force: true });
}
