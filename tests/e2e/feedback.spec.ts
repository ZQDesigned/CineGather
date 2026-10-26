import { registerTestAccount } from "./helpers/account";
import { test, expect, type Page } from "@playwright/test";

async function openInvite(page: Page) {
  await page.getByRole("button", { name: "创建私人房间", exact: true }).click();
  await page.getByLabel("房间名称").fill("复制反馈回归");
  await page.getByRole("button", { name: "创建并进入", exact: true }).click();
  await page.getByRole("button", { name: "邀请朋友", exact: true }).click();
}

test("copy feedback floats above an open modal, dismisses itself and can be shown again", async ({
  page,
}) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await registerTestAccount(page, "消息体验回归");
  await openInvite(page);
  const copy = page.getByRole("button", { name: "复制邀请链接", exact: true });
  for (let i = 0; i < 2; i++) {
    await copy.click();
    await expect(
      page
        .locator(".ant-message")
        .getByRole("status")
        .filter({ hasText: "邀请链接已复制" }),
    ).toHaveText("邀请链接已复制");
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.locator(".workspace > .toast")).toHaveCount(0);
    await expect(
      page
        .locator(".ant-message")
        .getByRole("status")
        .filter({ hasText: "邀请链接已复制" }),
    ).toHaveCount(0, { timeout: 6000 });
  }
  await page.mouse.move(0, 0);
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "邀请朋友", exact: true }),
  ).toBeFocused();
  await page.getByRole("button", { name: "离开房间", exact: true }).click();
});

test("a clipboard failure is reported through Notification while its modal stays usable", async ({
  page,
}) => {
  await page.addInitScript(() => {
    navigator.clipboard.writeText = async () => {
      throw new DOMException("剪贴板暂时不可用", "NotAllowedError");
    };
  });
  await page.goto("/");
  await registerTestAccount(page, "复制失败回归");
  await openInvite(page);
  await page.getByRole("button", { name: "复制邀请链接", exact: true }).click();
  await expect(
    page.locator(".ant-notification").getByRole("alert"),
  ).toContainText("无法写入剪贴板");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByLabel("房间邀请")).not.toBeEmpty();
  await page.getByRole("button", { name: "关闭对话框", exact: true }).click();
  await page.getByRole("button", { name: "离开房间", exact: true }).click();
});
