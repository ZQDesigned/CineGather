import { expect, type Page } from "@playwright/test";

export async function leaveSettings(page: Page) {
  const settings = page.getByRole("region", {
    name: "设置与设备页面",
    exact: true,
  });
  if (!(await settings.isVisible())) return;
  const room = page.getByRole("button", { name: "返回当前房间", exact: true });
  if (await room.isVisible()) await room.click();
  else await page.getByRole("menuitem", { name: /^我的房间/ }).click();
  await expect(settings).toHaveCount(0);
}
