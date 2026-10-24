import { test, expect, type Page } from "@playwright/test";
import type { UpdateStatus } from "@cinegather/contracts";

declare global {
  interface Window {
    updateTest?: { calls: string[]; emit(patch: Partial<UpdateStatus>): void };
  }
}
async function fixture(page: Page, mode: UpdateStatus["mode"]) {
  await page.addInitScript((mode) => {
    const calls: string[] = [];
    let status: UpdateStatus = {
      mode,
      status: mode === "disabled" ? "disabled" : "idle",
      currentVersion: "0.1.2",
      inRoom: false,
    };
    let listener: ((status: UpdateStatus) => void) | undefined;
    const emit = (patch: Partial<UpdateStatus>) => {
      status = { ...status, ...patch };
      listener?.({ ...status });
    };
    window.updateTest = { calls, emit };
    Object.assign(window, {
      desktop: {
        platform: mode === "notify" ? "darwin" : "win32",
        takeInvitation: async () => undefined,
        onAction: () => () => {},
        loadSettings: async () => ({
          noiseReduction: "enhanced",
          minimizeToTray: false,
          pushToTalk: false,
          pttShortcut: "CommandOrControl+Shift+Space",
          muteShortcut: "CommandOrControl+Shift+M",
          quality: "cinema",
          inputDevice: "",
          outputDevice: "",
        }),
        updates: {
          status: async () => ({ ...status }),
          check: async () => {
            calls.push("check");
            emit({
              status: "available",
              latestVersion: "0.1.3",
              notes: "改善通话体验",
            });
            return { ...status };
          },
          download: async () => {
            calls.push("download");
            emit({ status: "downloading", progress: 42 });
          },
          install: async () => {
            calls.push("install");
            emit({ status: "installing" });
          },
          openDownload: async () => {
            calls.push("open-download");
          },
          setInRoom: async () => {},
          onChange: (callback: typeof listener) => {
            listener = callback;
            return () => {
              listener = undefined;
            };
          },
        },
      },
    });
  }, mode);
  await page.goto("/");
  await page.getByRole("menuitem", { name: "设置与设备", exact: true }).click();
  await page.getByRole("tab", { name: "版本更新", exact: true }).click();
}
test("macOS checks and opens the release download without exposing installation", async ({
  page,
}) => {
  await fixture(page, "notify");
  await page.getByRole("button", { name: "检查更新", exact: true }).click();
  await expect(page.getByText("改善通话体验", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "下载新版", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "重启更新", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "下载更新", exact: true }),
  ).toHaveCount(0);
  expect(await page.evaluate(() => window.updateTest!.calls)).toEqual([
    "check",
    "open-download",
  ]);
});
test("Windows download, room exclusion and explicit restart confirmation", async ({
  page,
}) => {
  await fixture(page, "install");
  await page.getByRole("button", { name: "检查更新", exact: true }).click();
  await page.evaluate(() => window.updateTest!.emit({ inRoom: true }));
  await expect(
    page.getByRole("button", { name: "下载更新", exact: true }),
  ).toBeDisabled();
  await page.evaluate(() => window.updateTest!.emit({ inRoom: false }));
  await page.getByRole("button", { name: "下载更新", exact: true }).click();
  await expect(page.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "42",
  );
  await page.evaluate(() =>
    window.updateTest!.emit({ status: "downloaded", progress: 100 }),
  );
  await page.evaluate(() => window.updateTest!.emit({ inRoom: true }));
  await expect(
    page.getByRole("button", { name: "重启更新", exact: true }),
  ).toBeDisabled();
  await page.evaluate(() => window.updateTest!.emit({ inRoom: false }));
  await page.getByRole("button", { name: "重启更新", exact: true }).click();
  const confirmation = page
    .getByRole("dialog")
    .filter({ hasText: "重启并更新映聚？" });
  await confirmation.getByRole("button", { name: "稍后", exact: true }).click();
  await expect(confirmation).toHaveCount(0);
  expect(await page.evaluate(() => window.updateTest!.calls)).toEqual([
    "check",
    "download",
  ]);
  await page.getByRole("button", { name: "重启更新", exact: true }).click();
  await confirmation
    .getByRole("button", { name: "重启更新", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => window.updateTest!.calls))
    .toEqual(["check", "download", "install"]);
});
test("portable has no update actions and browser has no desktop update tab", async ({
  page,
}) => {
  await fixture(page, "disabled");
  await expect(
    page.getByText("此版本不提供在线更新", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "检查更新", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "取消", exact: true }).click();
  // A fresh browser context has no preload bridge.
  const browser = await page.context().browser()!.newContext();
  try {
    const tab = await browser.newPage();
    await tab.goto("http://127.0.0.1:5173");
    await tab
      .getByRole("menuitem", { name: "设置与设备", exact: true })
      .click();
    await expect(
      tab.getByRole("tab", { name: "版本更新", exact: true }),
    ).toHaveCount(0);
  } finally {
    await browser.close();
  }
});
test("background notification opens the update panel and network errors can retry", async ({
  page,
}) => {
  await fixture(page, "install");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.evaluate(() =>
    window.updateTest!.emit({ status: "available", latestVersion: "0.1.3" }),
  );
  await page.getByRole("button", { name: "查看更新", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("新版 v0.1.3");
  await page.evaluate(() =>
    window.updateTest!.emit({
      status: "error",
      error: "下载或验证更新失败，请重试。",
    }),
  );
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "下载或验证更新失败",
  );
  await page.getByRole("button", { name: "检查更新", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "下载更新", exact: true }),
  ).toBeEnabled();
});

test("real Electron IPC keeps development builds out of automatic installation", async () => {
  test.skip(
    !["darwin", "win32"].includes(process.platform),
    "Requires a native desktop host",
  );
  const { _electron } = await import("@playwright/test");
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join, resolve } = await import("node:path");
  const profile = await mkdtemp(join(tmpdir(), "cg-updates-ipc-"));
  const app = await _electron.launch({
    args: [resolve("apps/desktop"), `--user-data-dir=${profile}`],
  });
  try {
    const page = await app.firstWindow();
    expect(
      await page.evaluate(() => window.desktop!.updates!.status()),
    ).toMatchObject({ mode: "disabled", status: "disabled", inRoom: false });
    await page.evaluate(() => window.desktop!.updates!.setInRoom(true));
    expect(
      (await page.evaluate(() => window.desktop!.updates!.status())).inRoom,
    ).toBe(true);
    const rejected = await page.evaluate(async () => {
      try {
        await window.desktop!.updates!.install();
        return false;
      } catch {
        return true;
      }
    });
    expect(rejected).toBe(true);
    await page.evaluate(() => window.desktop!.updates!.setInRoom(false));
    await page
      .getByRole("menuitem", { name: "设置与设备", exact: true })
      .click();
    await page.getByRole("tab", { name: "版本更新", exact: true }).click();
    await expect(
      page.getByText("此版本不提供在线更新", { exact: true }),
    ).toBeVisible();
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true });
  }
});
