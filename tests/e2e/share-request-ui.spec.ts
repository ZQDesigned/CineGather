import { test, expect, type Page } from "@playwright/test";
import { registerTestAccount } from "./helpers/account";

async function source(page: Page) {
  await page.evaluate(() => {
    navigator.mediaDevices.getDisplayMedia = async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 360;
      const ctx = canvas.getContext("2d")!;
      const timer = setInterval(() => {
        ctx.fillStyle = `hsl(${Date.now() % 360},80%,40%)`;
        ctx.fillRect(0, 0, 640, 360);
      }, 33);
      const stream = canvas.captureStream(30);
      stream
        .getVideoTracks()[0]!
        .addEventListener("ended", () => clearInterval(timer));
      const audio = new AudioContext();
      const oscillator = audio.createOscillator();
      const destination = audio.createMediaStreamDestination();
      oscillator.connect(destination);
      oscillator.start();
      await audio.resume();
      const track = destination.stream.getAudioTracks()[0]!;
      track.addEventListener("ended", () => {
        oscillator.stop();
        void audio.close();
      });
      stream.addTrack(track);
      return stream;
    };
  });
}

test("login devices have their own settings tab", async ({ page }) => {
  await page.goto("/");
  await registerTestAccount(page, "设备标签测试");
  await page.getByRole("menuitem", { name: "设置与设备", exact: true }).click();
  await page.getByRole("tab", { name: "账号与安全", exact: true }).click();
  await expect(
    page.locator('section[aria-label="登录设备"]'),
  ).not.toBeVisible();
  await page.getByRole("tab", { name: "登录设备", exact: true }).click();
  await expect(page.getByText("当前设备", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "保存设置", exact: true }),
  ).toHaveCount(0);
});

test("sharing requests use bottom controls and actionable notifications, preserving the publisher until confirmation", async ({
  page,
  context,
  browser,
}) => {
  test.setTimeout(100000);
  await context.grantPermissions(["microphone"]);
  const other = await browser.newContext({ permissions: ["microphone"] });
  const viewer = await other.newPage();
  try {
    await page.goto("/");
    await registerTestAccount(page, "申请处理者");
    await page
      .getByRole("button", { name: "创建私人房间", exact: true })
      .click();
    await page.getByLabel("房间名称").fill("共享申请交互测试");
    await page.getByRole("button", { name: "创建并进入", exact: true }).click();
    await expect(page.locator(".connection")).toContainText("已连接");
    const code = (
      await page
        .getByRole("button", { name: "复制房间号", exact: true })
        .innerText()
    ).trim();
    await viewer.goto("/");
    await registerTestAccount(viewer, "申请共享者");
    await viewer.getByRole("button", { name: "加入房间", exact: true }).click();
    await viewer.getByLabel("房间号或邀请链接").fill(code);
    await viewer.getByRole("button", { name: "进入房间", exact: true }).click();
    await expect(viewer.locator(".connection")).toContainText("已连接");
    await expect(
      viewer.getByRole("button", { name: "申请共享", exact: true }),
    ).toHaveCount(0);
    await source(page);
    await source(viewer);
    await page
      .getByRole("button", { name: "选择屏幕开始共享", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "选择并共享", exact: true })
      .click();
    await expect(
      viewer
        .locator(".controls")
        .getByRole("button", { name: "申请共享", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "申请共享", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "共享接棒", exact: true }),
    ).toHaveCount(0);
    await viewer.getByRole("button", { name: "加入观看", exact: true }).click();
    await expect
      .poll(() =>
        viewer
          .locator(".stage video")
          .evaluate((v: HTMLVideoElement) => v.videoWidth),
      )
      .toBe(640);
    const small = await viewer
      .getByRole("button", { name: "观看小窗", exact: true })
      .boundingBox();
    const full = viewer.getByRole("button", { name: "全屏画面", exact: true });
    const bounds = await full.boundingBox();
    expect(small!.height).toBe(bounds!.height);
    expect(small!.y).toBe(bounds!.y);
    await expect(full).not.toHaveAttribute("title");
    await full.hover();
    await page.waitForTimeout(600);
    await expect(viewer.getByRole("tooltip")).toHaveCount(0);

    const incoming = page
      .locator(".ant-notification-notice")
      .filter({ hasText: "申请共享者 申请共享" });
    const outgoing = viewer
      .locator(".ant-notification-notice")
      .filter({ hasText: "共享申请已发送" });
    await viewer.getByRole("button", { name: "申请共享", exact: true }).click();
    await expect(
      incoming.getByRole("button", { name: "同意", exact: true }),
    ).toBeVisible({ timeout: 10000 });
    await expect(outgoing).toBeVisible();
    await viewer
      .locator(".controls")
      .getByRole("button", { name: "取消申请", exact: true })
      .click();
    await expect(incoming).toHaveCount(0, { timeout: 10000 });
    await expect(outgoing).toHaveCount(0);

    await viewer.getByRole("button", { name: "申请共享", exact: true }).click();
    await incoming.getByRole("button", { name: "拒绝", exact: true }).click();
    await expect(outgoing).toHaveCount(0, { timeout: 10000 });
    await viewer.getByRole("button", { name: "申请共享", exact: true }).click();
    await incoming.getByRole("button", { name: "同意", exact: true }).click();
    const ready = viewer
      .locator(".ant-notification-notice")
      .filter({ hasText: "共享申请已同意" });
    await ready.getByRole("button", { name: "选择来源", exact: true }).click();
    await viewer
      .getByRole("dialog")
      .getByRole("button", { name: "取消", exact: true })
      .click();
    await expect(page.locator(".sharing-banner")).toBeVisible();
    await ready.getByRole("button", { name: "选择来源", exact: true }).click();
    await viewer
      .getByRole("dialog")
      .getByRole("button", { name: "选择并共享", exact: true })
      .click();
    await expect(viewer.locator(".sharing-banner")).toBeVisible();
    await expect(page.locator(".sharing-banner")).toHaveCount(0);
    await expect(ready).toHaveCount(0);
    await expect(
      page
        .locator(".controls")
        .getByRole("button", { name: "申请共享", exact: true }),
    ).toBeVisible();
    await viewer
      .getByRole("button", { name: "停止共享", exact: true })
      .first()
      .click();
    await expect(
      page.getByRole("button", { name: "申请共享", exact: true }),
    ).toHaveCount(0);
  } catch (error) {
    console.error("Flow failed:", error);
    await viewer.screenshot({
      path: ".local/watch-share-devices/request-ui-failure.png",
    });
    throw error;
  } finally {
    for (const p of [viewer, page]) {
      await p
        .getByRole("dialog")
        .getByRole("button", { name: "取消", exact: true })
        .click({ timeout: 1500 })
        .catch(() => {});
      await p
        .getByRole("button", { name: "离开房间", exact: true })
        .click({ timeout: 1500 })
        .catch(() => {});
    }
    await other.close();
  }
});
