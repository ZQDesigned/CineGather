import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("connection checks explain readiness and failures without exposing developer metrics", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("menuitem", { name: "连接诊断", exact: true }).click();
  await expect(page.getByText("可以连接", { exact: true })).toBeVisible();
  await expect(
    page.getByText("还未加入房间", { exact: true }).first(),
  ).toBeVisible();
  const dialog = page.getByRole("dialog");
  await expect(dialog).not.toContainText(
    /API|RTT|WebRTC|JSON|丢包|活跃房间|请求.*错误/,
  );
  await expect(dialog.locator("pre")).toHaveCount(0);
  await page.route("**/api/v1/health", (route) =>
    route.fulfill({
      status: 503,
      json: { message: "INTERNAL_DATABASE_ERROR" },
    }),
  );
  await page.getByRole("button", { name: "重新检查", exact: true }).click();
  await expect(
    page.getByText("暂时无法连接服务器", { exact: true }),
  ).toBeVisible();
  await expect(dialog).not.toContainText(/INTERNAL_DATABASE_ERROR|503/);
  await page.getByRole("button", { name: "打开设置", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "设置与设备", exact: true }),
  ).toBeVisible();
});

test("packaged diagnostic exports retain server metrics and filter unapproved fields", async () => {
  const executablePath = resolve(
    "apps/desktop/release/mac-arm64/CineGather.app/Contents/MacOS/CineGather",
  );
  test.skip(
    process.platform !== "darwin" || !existsSync(executablePath),
    "Requires the local Mac package",
  );
  const profile = await mkdtemp(
    join(tmpdir(), "cinegather-diagnostic-export-"),
  );
  const target = join(profile, "report.json");
  const app = await electron.launch({
    executablePath,
    args: [`--user-data-dir=${profile}`],
  });
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, target);
    expect(
      await page.evaluate(() =>
        window.desktop!.exportDiagnostics({
          state: "connected",
          capturedAt: new Date().toISOString(),
          watching: true,
          tracks: [
            {
              type: "candidate-pair",
              currentRoundTripTime: 0.05,
              token: "fixture-private-token",
              localAddress: "fixture-private-address",
            },
          ],
          connection: { status: "available" },
          mediaCheck: "available",
          serverCheck: "available",
          shareState: "idle",
          server: {
            uptimeSeconds: 100,
            requests: 3,
            errors: 0,
            authDenied: 0,
            tokenIssueFailures: 0,
            averageDurationMs: 4,
            activeRooms: 1,
            token: "fixture-server-secret",
          },
        }),
      ),
    ).toBe(true);
    const text = await readFile(target, "utf8");
    const report = JSON.parse(text);
    expect(report.server.requests).toBe(3);
    expect(report.connection.status).toBe("available");
    expect(report.tracks[0].currentRoundTripTime).toBe(0.05);
    expect(report.platform).toBe("darwin");
    expect(report.versions.electron).toBeTruthy();
    expect(text).not.toMatch(
      /fixture-private-token|fixture-private-address|fixture-server-secret/,
    );
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test("room diagnostics show voice and sharing status while technical details remain available in exports", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("你的昵称").fill("通俗诊断回归");
  await page.getByRole("button", { name: "进入映聚", exact: true }).click();
  await page.getByRole("button", { name: "创建私人房间", exact: true }).click();
  await page.getByRole("button", { name: "创建并进入", exact: true }).click();
  await page.getByRole("button", { name: "关闭麦克风", exact: true }).waitFor();
  await page.getByRole("menuitem", { name: "连接诊断", exact: true }).click();
  await expect(page.getByText("房间连接正常", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("dialog").getByText("麦克风已开启", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("还未共享画面", { exact: true })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出诊断", exact: true }).click();
  await (await download).saveAs(".local/dialog-motion/diagnostics-export.json");
  const text = await readFile(
    ".local/dialog-motion/diagnostics-export.json",
    "utf8",
  );
  const report = JSON.parse(text);
  expect(report.state).toBe("connected");
  expect(Array.isArray(report.tracks)).toBe(true);
  expect(typeof report.server.requests).toBe("number");
  expect(typeof report.server.averageDurationMs).toBe("number");
  expect(text).not.toContain(
    await page.evaluate(() => localStorage.getItem("cinegather.session")),
  );
  await expect(page.getByRole("dialog")).not.toContainText(
    /API|RTT|WebRTC|JSON/,
  );
  await page.screenshot({ path: ".local/dialog-motion/diagnostics.png" });
  await page.getByRole("button", { name: "关闭对话框", exact: true }).click();
  await page.getByRole("button", { name: "关闭麦克风", exact: true }).click();
  await page.getByRole("menuitem", { name: "连接诊断", exact: true }).click();
  await expect(
    page.getByRole("dialog").getByText("麦克风已关闭", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("房间连接正常", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "关闭对话框", exact: true }).click();
  await page.getByRole("button", { name: "离开房间", exact: true }).click();
});
