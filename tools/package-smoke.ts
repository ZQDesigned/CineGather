import { _electron as electron, expect } from "@playwright/test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const platform = process.argv[2] ?? process.platform;
if (platform !== process.platform || !["darwin", "win32"].includes(platform))
  throw new Error(
    "Run the package smoke test on its native Mac or Windows host.",
  );
const executablePath = resolve(
  platform === "win32"
    ? "apps/desktop/release/win-unpacked/CineGather.exe"
    : "apps/desktop/release/mac-arm64/CineGather.app/Contents/MacOS/CineGather",
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
    args: [`--user-data-dir=${profile}`],
    timeout: 30000,
  });
  const page = await app.firstWindow();
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
    `Native ${platform} package boot, sandbox, N-API loading and global hotkey registration passed; physical key behavior is a separate test.`,
  );
} finally {
  if (app) await app.close();
  await rm(profile, { recursive: true, force: true });
}
