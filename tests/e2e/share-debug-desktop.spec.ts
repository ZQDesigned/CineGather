import {
  test,
  expect,
  _electron,
  type ElectronApplication,
} from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { defaultSettings } from "../../apps/desktop/src/shared/settings";
import { registerTestAccount } from "./helpers/account";

test("Mac native Debug reports real VideoToolbox output and cached IPC never starts capture", async ({
  browserName,
  browser,
}, info) => {
  test.skip(
    browserName !== "chromium" ||
      process.platform !== "darwin" ||
      process.env.CINEGATHER_DEBUG_DESKTOP_TEST !== "1",
    "Opt-in native Mac validation",
  );
  test.setTimeout(120000);
  const profile = await mkdtemp(join(tmpdir(), "cg-debug-"));
  let app: ElectronApplication | undefined;
  const peerContext = await browser.newContext({ permissions: ["microphone"] });
  const peer = await peerContext.newPage();
  const people: string[] = [],
    rooms: string[] = [];
  try {
    await writeFile(
      join(profile, "settings.json"),
      JSON.stringify({
        ...defaultSettings,
        noiseReduction: "off",
        pushToTalk: true,
        autoDownloadUpdates: false,
        roomSounds: false,
        notifications: { ...defaultSettings.notifications, sound: false },
        pttShortcut: "Control+Alt+Shift+F9",
        muteShortcut: "Control+Alt+Shift+F10",
      }),
    );
    app = await _electron.launch({
      args: [
        resolve("apps/desktop/out/main/index.cjs"),
        "--user-data-dir=" + profile,
        "--mute-audio",
      ],
      env: { ...process.env, ELECTRON_RENDERER_URL: "http://127.0.0.1:5173" },
    });
    const page = await app.firstWindow();
    await expect(page.locator(".app")).toBeVisible();
    expect(
      await page.evaluate(() => window.desktop!.diagnostics!.nativeStatus!()),
    ).toBeUndefined();
    await registerTestAccount(page, "Debug 原生编码验证");
    people.push(
      await page.evaluate(async () => {
        const { state } = await import("/store.ts" as string);
        return state().user.id;
      }),
    );
    await page
      .getByRole("button", { name: "创建私人房间", exact: true })
      .click();
    await page.getByLabel("房间名称").fill("Debug 原生实际采样");
    await page.getByRole("button", { name: "创建并进入", exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const { state } = await import("/store.ts" as string);
          return state().roomState;
        }),
      )
      .toBe("connected");
    rooms.push(
      await page.evaluate(async () => {
        const { state } = await import("/store.ts" as string);
        return state().room.id;
      }),
    );
    await page.getByRole("menuitem", { name: "连接诊断", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "连接诊断", exact: true });
    await dialog
      .getByRole("switch", { name: "Debug 模式", exact: true })
      .check();
    await dialog
      .getByRole("button", { name: "关闭对话框", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    expect(
      await page.evaluate(() => window.desktop!.diagnostics!.nativeStatus!()),
    ).toBeUndefined();
    await page
      .getByRole("button", { name: "选择屏幕开始共享", exact: true })
      .click();
    await page.getByRole("button", { name: "确认共享", exact: true }).click();
    const debug = page.getByLabel("推流 Debug 信息", { exact: true });
    await expect(debug).toContainText("VideoToolbox（硬件）", {
      timeout: 30000,
    });
    await expect(debug).toContainText("1920 × 1080");
    await expect(
      debug
        .locator("dl > div")
        .filter({ has: page.locator("dt", { hasText: "输出帧率" }) })
        .locator("dd"),
    ).toHaveText(/\d+ fps/, { timeout: 20000 });
    await page.screenshot({
      path: info.outputPath("native-debug.png"),
      animations: "disabled",
    });
    const actual = await page.evaluate(() =>
      window.desktop!.diagnostics!.nativeStatus!(),
    );
    expect(actual?.outputActive).toBe(true);
    expect(actual?.encoderBackend).toBe("videotoolbox");
    expect(actual?.hardwareEncoder).toBe(true);
    expect(actual?.outputTotalFrames).toBeGreaterThan(0);
    await page
      .locator(".sharing-banner")
      .getByRole("button", { name: "停止共享", exact: true })
      .click();
    await expect(debug).toHaveCount(0);
    const code = (
      await page
        .getByRole("button", { name: "复制房间号", exact: true })
        .innerText()
    ).trim();
    await peer.goto("/");
    await registerTestAccount(peer, "Debug 小窗共享源");
    people.push(
      await peer.evaluate(async () => {
        const { state } = await import("/store.ts" as string);
        return state().user.id;
      }),
    );
    await peer.getByRole("button", { name: "加入房间", exact: true }).click();
    await peer.getByLabel("房间号或邀请链接").fill(code);
    await peer.getByRole("button", { name: "进入房间", exact: true }).click();
    await peer.evaluate(() => {
      navigator.mediaDevices.getDisplayMedia = async () => {
        const c = document.createElement("canvas");
        c.width = 640;
        c.height = 360;
        const g = c.getContext("2d")!;
        let n = 0;
        const timer = setInterval(() => {
          g.fillStyle = n++ % 2 ? "#48306a" : "#26556a";
          g.fillRect(0, 0, 640, 360);
        }, 50);
        const stream = c.captureStream(20),
          track = stream.getVideoTracks()[0]!,
          stop = track.stop.bind(track);
        track.stop = () => {
          clearInterval(timer);
          stop();
        };
        return stream;
      };
    });
    await peer
      .getByRole("button", { name: "选择屏幕开始共享", exact: true })
      .click();
    await peer.getByRole("button", { name: "选择并共享", exact: true }).click();
    await page.getByRole("button", { name: "加入观看", exact: true }).click();
    await expect
      .poll(() =>
        page
          .getByLabel("共享画面", { exact: true })
          .evaluate((v) => (v as HTMLVideoElement).videoWidth),
      )
      .toBeGreaterThan(0);
    const childOpened = app.waitForEvent("window");
    await page.getByRole("button", { name: "观看小窗", exact: true }).click();
    const child = await childOpened;
    const miniDebug = child.getByLabel("观看 Debug 信息", { exact: true });
    await expect(miniDebug).toBeVisible();
    await expect(
      miniDebug
        .locator("dl > div")
        .filter({ has: child.locator("dt", { hasText: "接收 / 解码 / 显示" }) })
        .locator("dd"),
    ).toHaveText(/\d+ \/ \d+ \/ \d+ fps/, { timeout: 20000 });
    expect(
      await miniDebug.evaluate((e) => getComputedStyle(e).pointerEvents),
    ).toBe("none");
    await expect
      .poll(async () =>
        Number(
          await miniDebug
            .locator("dl > div")
            .filter({ has: child.locator("dt", { hasText: "距上一帧" }) })
            .locator("dd")
            .innerText()
            .then((v) => v.replace(" ms", "")),
        ),
      )
      .toBeLessThan(1500);
    await child.screenshot({
      path: info.outputPath("mini-window-debug.png"),
      animations: "disabled",
    });
    await child
      .getByRole("button", { name: "关闭观看小窗", exact: true })
      .click();
    console.log(
      JSON.stringify({
        nativeCachePassive: true,
        realVideoToolboxOutput: true,
        positiveOutputFrames: true,
        outputDimensions: true,
        customViewingWindowDebug: true,
        productionDataCreated: false,
      }),
    );
  } finally {
    await peer
      .evaluate(async () => {
        const { stopShare, roomSession } = await import(
          "/controller.ts" as string
        );
        await stopShare();
        await roomSession.leave();
      })
      .catch(() => {});
    await peerContext.close();
    if (app) {
      const p = await app.firstWindow().catch(() => undefined);
      await p
        ?.evaluate(async () => {
          const { stopShare, roomSession } = await import(
            "/controller.ts" as string
          );
          await stopShare();
          await roomSession.leave();
        })
        .catch(() => {});
      await app.close().catch(() => {});
    }
    if (people.length)
      execFileSync(
        "bun",
        [
          "tests/e2e/helpers/cleanup-room-invitations.ts",
          JSON.stringify({ users: people, rooms }),
        ],
        { stdio: "pipe" },
      );
    await rm(profile, { recursive: true, force: true });
  }
});
