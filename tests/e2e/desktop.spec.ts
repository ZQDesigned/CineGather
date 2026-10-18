import { test, expect, _electron as electron } from "@playwright/test";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const executablePath = resolve(
  "apps/desktop/release/mac-arm64/CineGather.app/Contents/MacOS/CineGather",
);
test("packaged desktop starts with a sandboxed renderer and the minimal typed bridge", async () => {
  test.skip(
    process.platform !== "darwin" || !existsSync(executablePath),
    "Build the Mac package first. Windows CI performs its own package smoke test.",
  );
  const profile = await mkdtemp(join(tmpdir(), "cinegather-smoke-"));
  const app = await electron.launch({
    executablePath,
    args: [`--user-data-dir=${profile}`],
    timeout: 30000,
  });
  try {
    const page = await app.firstWindow();
    await expect(
      page.getByRole("heading", { name: "给自己一个名字" }),
    ).toBeVisible();
    const preferences = await app.evaluate(({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0]!
        .webContents as unknown as {
        getLastWebPreferences(): {
          sandbox: boolean;
          contextIsolation: boolean;
          nodeIntegration: boolean;
        };
      };
      const p = contents.getLastWebPreferences();
      return {
        sandbox: p.sandbox,
        contextIsolation: p.contextIsolation,
        nodeIntegration: p.nodeIntegration,
      };
    });
    expect(preferences).toEqual({
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    });
    const bridge = await page.evaluate(() => ({
      platform: window.desktop?.platform,
      node: typeof (window as unknown as { require?: unknown }).require,
      keys: Object.keys(window.desktop ?? {}),
    }));
    expect(bridge.platform).toBe("darwin");
    expect(bridge.node).toBe("undefined");
    expect(bridge.keys).not.toContain("invoke");
    await page.getByRole("button", { name: "设置与设备", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.screenshot({ path: ".local/desktop-settings.png" });
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true });
  }
});
test("a first-launch invitation waits for guest onboarding instead of being lost before the renderer subscribes", async () => {
  test.skip(
    process.platform !== "darwin" || !existsSync(executablePath),
    "Requires a local Mac package.",
  );
  const profile = await mkdtemp(join(tmpdir(), "cinegather-invite-smoke-"));
  const invite = `cinegather://join?room=00000000-0000-4000-8000-000000000000&invite=${"x".repeat(43)}`;
  const app = await electron.launch({
    executablePath,
    args: [`--user-data-dir=${profile}`, invite],
    timeout: 30000,
  });
  try {
    const page = await app.firstWindow();
    await expect(
      page.getByRole("heading", { name: "给自己一个名字" }),
    ).toBeVisible();
    await expect(page.getByRole("status")).toContainText(
      "收到房间邀请，请先输入昵称",
    );
    await expect(page.getByRole("dialog")).toHaveCount(0);
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true });
  }
});
