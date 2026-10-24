import { registerTestAccount } from "./helpers/account";
import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { unzipSync, strFromU8 } from "fflate";
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
  test.skip(
    process.platform === "linux",
    "Native desktop test runs on macOS/Windows.",
  );
  const profile = await mkdtemp(
    join(tmpdir(), "cinegather-diagnostic-export-"),
  );
  const target = join(profile, "report.zip");
  const app = await electron.launch({
    args: [resolve("apps/desktop"), `--user-data-dir=${profile}`],
    env: { ...process.env, ELECTRON_RENDERER_URL: "" },
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
    const files = unzipSync(await readFile(target));
    const text = Object.values(files)
      .map((value) => strFromU8(value))
      .join("\n");
    const report = JSON.parse(strFromU8(files["current.json"]!));
    const manifest = JSON.parse(strFromU8(files["manifest.json"]!));
    expect(files["timeline.ndjson"]).toBeTruthy();
    expect(files["intervals.csv"]).toBeTruthy();
    expect(report.server.requests).toBe(3);
    expect(report.connection.status).toBe("available");
    expect(report.tracks[0].currentRoundTripTime).toBe(0.05);
    expect(manifest.platform).toBe(process.platform);
    expect(manifest.versions.electron).toBeTruthy();
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
  await registerTestAccount(page, "通俗诊断回归");
  await page.getByRole("button", { name: "创建私人房间", exact: true }).click();
  await page.getByRole("button", { name: "创建并进入", exact: true }).click();
  await page.getByRole("button", { name: "关闭麦克风", exact: true }).waitFor();
  await page.getByRole("menuitem", { name: "连接诊断", exact: true }).click();
  await expect(page.getByText("房间连接正常", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("dialog").getByText("麦克风已开启", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("还未共享画面", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "标记当前卡顿", exact: true }).click();
  await expect(
    page.getByText("已标记当前卡顿时间", { exact: true }),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出诊断", exact: true }).click();
  await (await download).saveAs(".local/media-diagnostics/browser-export.zip");
  const files = unzipSync(
    await readFile(".local/media-diagnostics/browser-export.zip"),
  );
  const text = Object.values(files)
    .map((value) => strFromU8(value))
    .join("\n");
  const report = JSON.parse(strFromU8(files["current.json"]!));
  expect(files["timeline.ndjson"]).toBeTruthy();
  expect(files["summary.json"]).toBeTruthy();
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

test("paired diagnostic ZIPs correlate real video send/receive and retain an induced render stall", async ({
  browser,
}) => {
  test.setTimeout(90000);
  const senderContext = await browser.newContext({
    permissions: ["microphone"],
  });
  const viewerContext = await browser.newContext({
    permissions: ["microphone"],
  });
  const sender = await senderContext.newPage(),
    viewer = await viewerContext.newPage();
  const exportZip = async (page: typeof sender, name: string) => {
    await page.getByRole("menuitem", { name: "连接诊断", exact: true }).click();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "导出诊断", exact: true }).click();
    const path = `.local/media-diagnostics/${name}.zip`;
    await (await download).saveAs(path);
    const files = unzipSync(await readFile(path));
    return {
      files,
      entries: strFromU8(files["timeline.ndjson"]!)
        .trim()
        .split("\n")
        .map(
          (line) =>
            JSON.parse(
              line,
            ) as import("@cinegather/contracts").DiagnosticRecord,
        ),
    };
  };
  try {
    await sender.goto("/");
    await registerTestAccount(sender, "诊断共享端");
    await sender
      .getByRole("button", { name: "创建私人房间", exact: true })
      .click();
    await sender
      .getByRole("button", { name: "创建并进入", exact: true })
      .click();
    const code = (
      await sender
        .getByRole("button", { name: "复制房间号", exact: true })
        .innerText()
    ).trim();
    await viewer.goto("/");
    await registerTestAccount(viewer, "诊断观看端");
    await viewer.getByRole("button", { name: "加入房间", exact: true }).click();
    await viewer.getByLabel("房间号或邀请链接").fill(code);
    await viewer.getByRole("button", { name: "进入房间", exact: true }).click();
    await sender.evaluate(() => {
      navigator.mediaDevices.getDisplayMedia = async () => {
        const canvas = document.createElement("canvas");
        canvas.width = 640;
        canvas.height = 360;
        const context = canvas.getContext("2d")!;
        let tick = 0;
        setInterval(() => {
          context.fillStyle = `hsl(${tick++ % 360},70%,45%)`;
          context.fillRect(0, 0, 640, 360);
          context.fillStyle = "white";
          context.fillRect(tick % 500, 100, 50, 50);
        }, 33);
        return canvas.captureStream(30);
      };
    });
    await sender
      .getByRole("button", { name: "选择屏幕开始共享", exact: true })
      .click();
    await sender
      .getByRole("button", { name: "选择并共享", exact: true })
      .click();
    await viewer.getByRole("button", { name: "加入观看", exact: true }).click();
    await expect
      .poll(() =>
        viewer
          .locator("video")
          .evaluate((video: HTMLVideoElement) => video.videoWidth),
      )
      .toBeGreaterThan(0);
    // A real main-thread stall exercises long-task and presentation-gap evidence.
    await viewer.evaluate(
      () =>
        new Promise<void>((resolve) =>
          setTimeout(() => {
            const until = performance.now() + 350;
            while (performance.now() < until) {
              /* controlled stall */
            }
            resolve();
          }, 1000),
        ),
    );
    await viewer
      .getByRole("menuitem", { name: "连接诊断", exact: true })
      .click();
    await viewer
      .getByRole("button", { name: "标记当前卡顿", exact: true })
      .click();
    await viewer
      .getByRole("button", { name: "关闭对话框", exact: true })
      .click();
    await expect
      .poll(
        async () => {
          const database = await viewer.evaluate(
            () =>
              new Promise<number>((resolve, reject) => {
                const request = indexedDB.open("cinegather-diagnostics", 2);
                request.onsuccess = () => {
                  const db = request.result;
                  const all = db
                    .transaction("records")
                    .objectStore("records")
                    .getAll();
                  all.onsuccess = () => {
                    resolve(
                      all.result.filter((row) =>
                        row.entry.media?.tracks.some(
                          (track: {
                            kind: string;
                            local: boolean;
                            stats: { framesDecoded?: number }[];
                          }) =>
                            track.kind === "video" &&
                            !track.local &&
                            track.stats.some(
                              (stat) => (stat.framesDecoded ?? 0) > 0,
                            ),
                        ),
                      ).length,
                    );
                    db.close();
                  };
                  all.onerror = () => reject(all.error);
                };
                request.onerror = () => reject(request.error);
              }),
          );
          return database;
        },
        { timeout: 20000 },
      )
      .toBeGreaterThanOrEqual(3);
    const sent = await exportZip(sender, "paired-sender"),
      received = await exportZip(viewer, "paired-viewer");
    const inbound = received.entries
      .flatMap((entry) => entry.media?.tracks ?? [])
      .find(
        (track) =>
          track.kind === "video" &&
          !track.local &&
          track.stats.some((stat) => (stat.framesDecoded ?? 0) > 0),
      )!;
    expect(inbound).toBeTruthy();
    expect(
      sent.entries
        .flatMap((entry) => entry.media?.tracks ?? [])
        .some(
          (track) =>
            track.local &&
            track.track === inbound.track &&
            track.participant === inbound.participant &&
            track.stats.some((stat) => (stat.framesEncoded ?? 0) > 0),
        ),
    ).toBe(true);
    expect(received.entries.some((entry) => entry.kind === "marker")).toBe(
      true,
    );
    expect(
      received.entries.some(
        (entry) => (entry.renderer?.longTaskMs ?? 0) >= 300,
      ),
    ).toBe(true);
    expect(
      received.entries.some(
        (entry) => (entry.media?.playback?.maxFrameGapMs ?? 0) >= 200,
      ),
    ).toBe(true);
    expect(strFromU8(received.files["frame-pipeline.csv"]!)).toContain(
      "presentedFps",
    );
    expect(strFromU8(received.files["intervals.csv"]!)).toContain(
      "inbound-rtp",
    );
    await sender
      .getByRole("button", { name: "关闭对话框", exact: true })
      .click();
    await viewer
      .getByRole("button", { name: "关闭对话框", exact: true })
      .click();
    await sender.getByRole("button", { name: "离开房间", exact: true }).click();
    await viewer.getByRole("button", { name: "离开房间", exact: true }).click();
  } finally {
    await senderContext.close();
    await viewerContext.close();
  }
});
