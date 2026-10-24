import { test, expect, type Page } from "@playwright/test";
import { registerTestAccount } from "./helpers/account";
async function toggle(page: Page, name: string, permission: string) {
  await page
    .getByRole("button", { name: `${name}的成员操作`, exact: true })
    .click();
  await page
    .getByRole("menuitemcheckbox", { name: permission, exact: true })
    .click();
}
async function start(page: Page) {
  await page
    .getByRole("button", { name: "选择屏幕开始共享", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "选择并共享", exact: true })
    .click();
  await expect(page.locator(".sharing-banner")).toBeVisible();
}
async function join(page: Page, code: string) {
  await page.getByRole("button", { name: "加入房间", exact: true }).click();
  await page.getByLabel("房间号或邀请链接").fill(code);
  await page.getByRole("button", { name: "进入房间", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".connection")).toContainText("已连接");
}
async function leave(page: Page) {
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const exit = page.getByRole("button", { name: "离开房间", exact: true });
  if (await exit.count()) await exit.click();
  await expect(page.locator(".connection")).toContainText("未连接房间");
}
test("persistent member restrictions revoke real tracks, survive rejoining, and restore permission without auto-opening capture", async ({
  page,
  context,
  browser,
}) => {
  test.setTimeout(90000);
  await context.grantPermissions(["microphone"]);
  const other = await browser.newContext({ permissions: ["microphone"] });
  const member = await other.newPage();
  try {
    await page.goto("/");
    await registerTestAccount(page, "权限房主");
    await page
      .getByRole("button", { name: "创建私人房间", exact: true })
      .click();
    await page.getByLabel("房间名称").fill("成员权限实测");
    await page.getByRole("button", { name: "创建并进入", exact: true }).click();
    const code = (
      await page
        .getByRole("button", { name: "复制房间号", exact: true })
        .innerText()
    ).trim();
    await member.goto("/");
    await registerTestAccount(member, "受限成员");
    await member.evaluate(() => {
      navigator.mediaDevices.getDisplayMedia = async () => {
        const canvas = document.createElement("canvas");
        canvas.width = 640;
        canvas.height = 360;
        const ctx = canvas.getContext("2d")!;
        const timer = setInterval(() => {
          ctx.fillStyle = `hsl(${Date.now() % 360},80%,40%)`;
          ctx.fillRect(0, 0, 640, 360);
        }, 80);
        const stream = canvas.captureStream(12);
        Object.assign(window, { sharedTracks: stream.getTracks() });
        stream
          .getVideoTracks()[0]!
          .addEventListener("ended", () => clearInterval(timer));
        return stream;
      };
    });
    await join(member, code);
    await expect(
      member.getByRole("button", { name: "关闭麦克风", exact: true }),
    ).toBeEnabled();
    await start(member);
    await expect(page.locator(".video-label")).toContainText(
      "受限成员正在共享",
    );
    await toggle(page, "受限成员", "禁止开麦");
    await expect(
      member.getByRole("button", { name: "开启麦克风", exact: true }),
    ).toBeDisabled();
    await expect(
      member.getByText("已被禁止开麦", { exact: true }).first(),
    ).toBeVisible();
    await expect(page.locator(".video-label")).toContainText(
      "受限成员正在共享",
    );
    await member
      .getByRole("button", { name: "停止共享", exact: true })
      .first()
      .click();
    await expect(member.locator(".sharing-banner")).toHaveCount(0);
    await start(member);
    await expect(
      member.getByRole("button", { name: "开启麦克风", exact: true }),
    ).toBeDisabled();
    await expect(page.locator(".video-label")).toContainText(
      "受限成员正在共享",
    );
    await toggle(page, "受限成员", "禁止共享");
    await expect(member.locator(".sharing-banner")).toHaveCount(0);
    await expect(
      member.getByRole("button", { name: "已被禁止共享", exact: true }).first(),
    ).toBeDisabled();
    await expect
      .poll(() =>
        member.evaluate(() =>
          (
            window as unknown as { sharedTracks: MediaStreamTrack[] }
          ).sharedTracks.every((t) => t.readyState === "ended"),
        ),
      )
      .toBe(true);
    await page
      .getByRole("button", { name: "受限成员的成员操作", exact: true })
      .click();
    await expect(
      page.getByRole("menuitemcheckbox", { name: "禁止开麦", exact: true }),
    ).toHaveAttribute("aria-checked", "true");
    await expect(
      page.getByRole("menuitemcheckbox", { name: "禁止共享", exact: true }),
    ).toHaveAttribute("aria-checked", "true");
    await page
      .getByRole("menuitemcheckbox", { name: "禁止共享", exact: true })
      .hover();
    await page.screenshot({
      path: ".local/room-moderation/restrictions-menu.png",
    });
    await page.keyboard.press("Escape");
    await leave(member);
    await member.evaluate(() => {
      const original = navigator.mediaDevices.getUserMedia.bind(
        navigator.mediaDevices,
      );
      Object.assign(window, { microphoneCaptures: 0 });
      navigator.mediaDevices.getUserMedia = async (constraints) => {
        if (constraints?.audio)
          (window as unknown as { microphoneCaptures: number })
            .microphoneCaptures++;
        return original(constraints);
      };
    });
    await join(member, code);
    await expect(
      member.getByRole("button", { name: "开启麦克风", exact: true }),
    ).toBeDisabled();
    await expect(
      member.getByRole("button", { name: "已被禁止共享", exact: true }).first(),
    ).toBeDisabled();
    expect(
      await member.evaluate(
        () =>
          (window as unknown as { microphoneCaptures: number })
            .microphoneCaptures,
      ),
    ).toBe(0);
    await toggle(page, "受限成员", "禁止开麦");
    await expect(
      member.getByRole("button", { name: "开启麦克风", exact: true }),
    ).toBeEnabled();
    await expect(
      member.locator(".members-list .member").filter({ hasText: "受限成员" }),
    ).toContainText("麦克风已关闭");
    await toggle(page, "受限成员", "禁止共享");
    await expect(
      member.getByRole("button", { name: "选择屏幕开始共享", exact: true }),
    ).toBeEnabled();
    await expect(member.locator(".sharing-banner")).toHaveCount(0);
    await member
      .getByRole("button", { name: "开启麦克风", exact: true })
      .click();
    await expect(
      member.getByRole("button", { name: "关闭麦克风", exact: true }),
    ).toBeEnabled();
    await start(member);
    await expect(page.locator(".video-label")).toContainText(
      "受限成员正在共享",
    );
    await toggle(page, "受限成员", "禁止开麦");
    await toggle(page, "受限成员", "禁止共享");
    await page
      .getByRole("button", { name: "受限成员的成员操作", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "转移房主", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "确认转移", exact: true })
      .click();
    await expect(
      member.getByRole("button", { name: "房间设置", exact: true }),
    ).toBeVisible();
    await expect(
      member.getByRole("button", { name: "开启麦克风", exact: true }),
    ).toBeEnabled();
    await expect(
      member.getByRole("button", { name: "选择屏幕开始共享", exact: true }),
    ).toBeEnabled();
    await expect(
      page.getByRole("button", { name: "房间设置", exact: true }),
    ).toHaveCount(0);
    await expect(member.locator(".sharing-banner")).toHaveCount(0);
  } finally {
    await leave(member);
    await leave(page);
    await other.close();
  }
});
