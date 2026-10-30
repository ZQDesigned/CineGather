import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { registerTestAccount } from "./helpers/account";

test("Debug overlay shares real two-second sampling and distinguishes sender, receiver and paused viewing", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(120000);
  const context = await browser.newContext({ permissions: ["microphone"] }),
    viewer = await context.newPage();
  const people: string[] = [],
    rooms: string[] = [];
  const account = async (p: Page, name: string) => {
    await p.goto("/");
    await registerTestAccount(p, name);
    people.push(
      await p.evaluate(async () => {
        const { state } = await import("/store.ts" as string);
        return state().user.id;
      }),
    );
  };
  const debug = async (p: Page, on: boolean) => {
    await p.getByRole("menuitem", { name: "连接诊断", exact: true }).click();
    const dialog = p.getByRole("dialog", { name: "连接诊断", exact: true });
    await dialog
      .getByRole("switch", { name: "Debug 模式", exact: true })
      .setChecked(on);
    await dialog
      .getByRole("button", { name: "关闭对话框", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
  };
  try {
    await account(page, "Debug 推流验证");
    await page
      .getByRole("button", { name: "创建私人房间", exact: true })
      .click();
    await page.getByLabel("房间名称").fill("Debug 实际采样验证");
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
    const code = (
      await page
        .getByRole("button", { name: "复制房间号", exact: true })
        .innerText()
    ).trim();
    await debug(page, true);
    await expect(
      page.getByLabel("推流 Debug 信息", { exact: true }),
    ).toHaveCount(0);
    await account(viewer, "Debug 观看验证");
    await viewer.getByRole("button", { name: "加入房间", exact: true }).click();
    await viewer.getByLabel("房间号或邀请链接").fill(code);
    await viewer.getByRole("button", { name: "进入房间", exact: true }).click();
    await expect
      .poll(() =>
        viewer.evaluate(async () => {
          const { state } = await import("/store.ts" as string);
          return state().roomState;
        }),
      )
      .toBe("connected");
    await page.evaluate(() => {
      navigator.mediaDevices.getDisplayMedia = async () => {
        const c = document.createElement("canvas");
        c.width = 640;
        c.height = 360;
        const g = c.getContext("2d")!;
        let n = 0;
        const timer = setInterval(() => {
          g.fillStyle = n++ % 2 ? "#563480" : "#154a67";
          g.fillRect(0, 0, 640, 360);
          g.fillStyle = "white";
          g.font = "30px sans-serif";
          g.fillText(String(n), 20, 60);
        }, 50);
        const stream = c.captureStream(20);
        const track = stream.getVideoTracks()[0]!;
        const stop = track.stop.bind(track);
        track.stop = () => {
          clearInterval(timer);
          stop();
        };
        return stream;
      };
    });
    await page
      .getByRole("button", { name: "选择屏幕开始共享", exact: true })
      .click();
    await page.getByRole("button", { name: "选择并共享", exact: true }).click();
    await debug(viewer, true);
    const receive = viewer.getByLabel("观看 Debug 信息", { exact: true }),
      send = page.getByLabel("推流 Debug 信息", { exact: true });
    await expect(receive).toContainText("尚未加入观看");
    await viewer.getByRole("button", { name: "加入观看", exact: true }).click();
    await expect(
      send
        .locator("dl > div")
        .filter({ has: page.locator("dt", { hasText: "编码帧率" }) })
        .locator("dd"),
    ).toHaveText(/\d+ fps/, { timeout: 20000 });
    const fps = receive
      .locator("dl > div")
      .filter({ has: viewer.locator("dt", { hasText: "接收 / 解码 / 显示" }) })
      .locator("dd");
    await expect(fps).toHaveText(/\d+ \/ \d+ \/ \d+ fps/, { timeout: 20000 });
    await expect(receive).toContainText("丢包（本次间隔）");
    const geometry = await receive.evaluate((panel) => {
      const p = panel.getBoundingClientRect(),
        s = panel.parentElement!.getBoundingClientRect(),
        css = getComputedStyle(panel);
      return {
        right: s.right - p.right,
        top: p.top - s.top,
        bottom: p.bottom <= s.bottom,
        pointer: css.pointerEvents,
        background: css.backgroundColor,
      };
    });
    expect(geometry.right).toBeGreaterThan(0);
    expect(geometry.right).toBeLessThan(16);
    expect(geometry.top).toBeLessThan(16);
    expect(geometry.bottom).toBe(true);
    expect(geometry.pointer).toBe("none");
    expect(geometry.background).toMatch(/rgba/);
    await viewer.screenshot({
      path: info.outputPath("receiver-debug.png"),
      animations: "disabled",
    });
    await page.screenshot({
      path: info.outputPath("sender-debug.png"),
      animations: "disabled",
    });
    await viewer.getByRole("button", { name: "全屏画面", exact: true }).click();
    await expect
      .poll(() =>
        viewer.evaluate(() =>
          Boolean(
            document.fullscreenElement?.querySelector(
              '[aria-label="观看 Debug 信息"]',
            ),
          ),
        ),
      )
      .toBe(true);
    await viewer.evaluate(() => document.exitFullscreen());
    await viewer.evaluate(async () => {
      const { media } = await import("/controller.ts" as string);
      media.setVideoVisible(false);
    });
    await expect(receive).toContainText("画面接收已暂停");
    await viewer.evaluate(async () => {
      const { media } = await import("/controller.ts" as string);
      media.setVideoVisible(true);
    });
    await expect(fps).toHaveText(/\d+ \/ \d+ \/ \d+ fps/, { timeout: 20000 });
    await debug(viewer, false);
    await expect(receive).toHaveCount(0);
    await debug(viewer, true);
    await expect(receive).toBeVisible();
    await page
      .locator(".sharing-banner")
      .getByRole("button", { name: "停止共享", exact: true })
      .click();
    await expect(receive).toHaveCount(0);
    await expect(send).toHaveCount(0);
    console.log(
      JSON.stringify({
        realSharedVideo: true,
        twoRoles: true,
        intervalMetrics: true,
        topRightAndPointerTransparent: true,
        fullscreen: true,
        pausedClearsMetrics: true,
        disabledAndStoppedHide: true,
        productionDataCreated: false,
      }),
    );
  } finally {
    for (const p of [page, viewer])
      await p
        .evaluate(async () => {
          const { roomSession } = await import("/controller.ts" as string);
          await roomSession.leave();
        })
        .catch(() => {});
    await context.close();
    if (people.length)
      execFileSync(
        "bun",
        [
          "tests/e2e/helpers/cleanup-room-invitations.ts",
          JSON.stringify({ users: people, rooms }),
        ],
        { stdio: "pipe" },
      );
  }
});
