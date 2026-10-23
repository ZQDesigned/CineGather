import { test, expect } from "@playwright/test";

test("copy feedback floats above an open modal, dismisses itself and can be shown again", async ({
  page,
}) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await page.getByRole("button", { name: "访客体验", exact: true }).click();
  await page.getByLabel("你的昵称").fill("消息体验回归");
  await page.getByRole("button", { name: "进入映聚", exact: true }).click();
  await page.getByRole("menuitem", { name: "好友", exact: true }).click();
  const copy = page.getByRole("button", { name: /我的用户 ID/ });
  for (let i = 0; i < 2; i++) {
    await copy.click();
    await expect(page.locator(".ant-message").getByRole("status")).toHaveText(
      "你的用户 ID 已复制",
    );
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.locator(".workspace > .toast")).toHaveCount(0);
    await expect(page.locator(".ant-message").getByRole("status")).toHaveCount(
      0,
      { timeout: 6000 },
    );
  }
  await page.mouse.move(0, 0);
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("menuitem", { name: "好友", exact: true }),
  ).toBeFocused();
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
  await page.getByRole("button", { name: "访客体验", exact: true }).click();
  await page.getByLabel("你的昵称").fill("复制失败回归");
  await page.getByRole("button", { name: "进入映聚", exact: true }).click();
  await page.getByRole("menuitem", { name: "好友", exact: true }).click();
  await page.getByRole("button", { name: /我的用户 ID/ }).click();
  await expect(
    page.locator(".ant-notification").getByRole("alert"),
  ).toContainText("无法写入剪贴板");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByLabel("好友用户 ID").fill("仍可继续输入");
});
