import { registerTestAccount } from "./helpers/account";
import { test, expect, type Page } from "@playwright/test";

async function guest(page: Page, name: string) {
  await page.goto("/");
  await registerTestAccount(page, name);
  await expect(
    page.getByRole("heading", { name: `晚上好，${name}` }),
  ).toBeVisible();
}
async function join(page: Page, invitation: string) {
  await page.getByRole("button", { name: "加入房间", exact: true }).click();
  await page.getByLabel("房间号或邀请链接").fill(invitation);
  await page.getByRole("button", { name: "进入房间", exact: true }).click();
}

test("friends and owner moderation work across independent real room clients", async ({
  page,
  browser,
}) => {
  const context = await browser.newContext({ permissions: ["microphone"] });
  const friend = await context.newPage();
  try {
    await guest(page, "社交房主");
    await page
      .getByRole("button", { name: "创建私人房间", exact: true })
      .click();
    await page.getByLabel("房间名称").fill("社交权限实测");
    await page.getByRole("button", { name: "创建并进入" }).click();
    await expect(
      page.getByRole("heading", { name: "社交权限实测" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "邀请朋友", exact: true }).click();
    const invitation = await page.getByLabel("房间邀请").inputValue();
    await page.getByRole("button", { name: "关闭对话框" }).click();
    await guest(friend, "社交成员");
    await join(friend, invitation);
    await expect(page.locator(".members-list .member")).toHaveCount(2);
    const avatarGap = await page
      .locator(".member")
      .first()
      .evaluate((row) => {
        const avatar = row
          .querySelector(".ant-avatar")!
          .getBoundingClientRect();
        return (
          row.querySelector(".member-main")!.getBoundingClientRect().left -
          avatar.right
        );
      });
    expect(avatarGap).toBeGreaterThanOrEqual(12);
    await expect(
      friend.getByRole("button", { name: "管理房间黑名单" }),
    ).toHaveCount(0);
    await page
      .locator(".member")
      .filter({ hasText: "社交成员" })
      .click({ button: "right" });
    await page.getByRole("menuitem", { name: "添加好友", exact: true }).click();
    await expect(page.locator(".member-context-popup")).toHaveCount(0);
    await expect(
      page.getByRole("status").filter({ hasText: "好友请求已发送" }),
    ).toContainText("好友请求已发送");
    await expect(
      friend.locator(".friend-request-indicator .ant-badge-dot"),
    ).toBeVisible({ timeout: 10000 });
    await expect(
      page.locator(".friend-request-indicator .ant-badge-dot"),
    ).toHaveCount(0);
    await friend.getByRole("menuitem", { name: "好友", exact: true }).click();
    await friend.getByRole("tab", { name: /^好友申请/ }).click();
    const friendId = await friend.evaluate(async () => {
      const { useApp } = await import("/store.ts" as string);
      return useApp.getState().user.id as string;
    });
    await expect(friend.locator(".friend")).toContainText("社交房主");
    await friend.getByRole("button", { name: "接受", exact: true }).click();
    await friend.getByRole("tab", { name: /^全部好友/ }).click();
    await expect(friend.locator(".friend small")).toHaveText("房间中（2/5）", {
      timeout: 10000,
    });
    await expect(
      friend.locator(".friend-request-indicator .ant-badge-dot"),
    ).toHaveCount(0);
    await friend
      .getByRole("button", { name: "返回当前房间", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "好友", exact: true }).click();
    await expect(page.locator(".friend")).toContainText("社交成员");
    await expect(page.locator(".friend small")).toHaveText("房间中（2/5）", {
      timeout: 10000,
    });
    await page
      .getByRole("button", { name: "移除社交成员", exact: true })
      .click();
    await expect(page.locator(".friend")).toHaveCount(0);
    await page
      .getByRole("button", { name: "返回当前房间", exact: true })
      .click();
    await page.getByRole("button", { name: "管理房间黑名单" }).click();
    await page.getByLabel("要封禁的用户 ID").fill(friendId!);
    await page.getByRole("button", { name: "封禁成员", exact: true }).click();
    await expect(page.locator(".friend")).toContainText("社交成员");
    await expect(
      friend
        .locator(".ant-notification")
        .getByRole("alert")
        .filter({ hasText: "你已被房主移出房间" }),
    ).toContainText("你已被房主移出房间");
    await expect(friend.locator(".home")).toBeVisible();
    await expect(friend.locator(".room-page")).toHaveCount(0);
    await join(friend, invitation);
    await expect(
      friend
        .locator(".ant-notification")
        .getByRole("alert")
        .filter({ hasText: "你已被此房间禁止加入" }),
    ).toContainText("你已被此房间禁止加入");
    await page.getByRole("button", { name: "解除封禁", exact: true }).click();
    await expect(page.locator(".friend")).toHaveCount(0);
    await page.getByRole("button", { name: "关闭对话框" }).click();
    await friend.getByRole("button", { name: "进入房间", exact: true }).click();
    await expect(page.locator(".members-list .member")).toHaveCount(2);
    await expect(friend.getByRole("dialog")).toHaveCount(0);
    await friend
      .locator(".member")
      .filter({ hasText: "社交房主" })
      .click({ button: "right" });
    await expect(
      friend.getByRole("slider", { name: "社交房主的音量", exact: true }),
    ).toBeVisible();
    await expect(
      friend.getByRole("menuitem", { name: "移出房间", exact: true }),
    ).toHaveCount(0);
    await friend.keyboard.press("Escape");
    await page
      .getByRole("button", { name: "社交成员的成员操作", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "移出房间", exact: true }).click();
    await expect(page.locator(".members-list .member")).toHaveCount(1);
    await expect(
      friend
        .locator(".ant-notification")
        .getByRole("alert")
        .filter({ hasText: "你已被房主移出房间" }),
    ).toContainText("你已被房主移出房间");
    await expect(friend.locator(".home")).toBeVisible();
    await expect(
      friend.getByRole("button", { name: "重新连接", exact: true }),
    ).toHaveCount(0);
    await expect(friend.locator("audio[data-cinegather-audio]")).toHaveCount(0);
    await page.getByRole("button", { name: "离开房间", exact: true }).click();
  } finally {
    await context.close();
  }
});

test("revoking an invitation in the client prevents a new guest from using it", async ({
  page,
  browser,
}) => {
  const context = await browser.newContext();
  try {
    await guest(page, "邀请房主");
    await page
      .getByRole("button", { name: "创建私人房间", exact: true })
      .click();
    await page.getByLabel("房间名称").fill("撤销邀请实测");
    await page.getByRole("button", { name: "创建并进入" }).click();
    await expect(
      page.getByRole("heading", { name: "撤销邀请实测" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "邀请朋友", exact: true }).click();
    const invitation = await page.getByLabel("房间邀请").inputValue();
    await page
      .getByRole("button", { name: "撤销这条邀请", exact: true })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: "此邀请已撤销" }),
    ).toContainText("此邀请已撤销");
    const outsider = await context.newPage();
    await guest(outsider, "撤销后访客");
    await join(outsider, invitation);
    await expect(
      outsider.locator(".ant-notification").getByRole("alert"),
    ).toContainText("邀请无效");
    await expect(outsider.locator(".members-list .member")).toHaveCount(0);
    await page.getByRole("button", { name: "离开房间", exact: true }).click();
  } finally {
    await context.close();
  }
});
