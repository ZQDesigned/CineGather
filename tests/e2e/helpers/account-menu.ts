import type { Page } from "@playwright/test";

export async function selectAccountMenu(
  page: Page,
  name: "设置与设备" | "连接诊断" | "退出登录",
) {
  await page.getByRole("button", { name: "账户菜单", exact: true }).click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}
