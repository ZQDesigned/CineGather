import { expect, type Page } from "@playwright/test";
export const testPassword = "Local test password 123!";
// Every isolated test uses a real account, through the same registration UI as users.
export async function registerTestAccount(page: Page, displayName: string) {
  await page.getByRole("tab", { name: "注册", exact: true }).click();
  await page
    .getByLabel("用户名", { exact: true })
    .fill(`e2e_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`);
  await page.getByLabel("昵称", { exact: true }).fill(displayName);
  await page.getByLabel("密码", { exact: true }).fill(testPassword);
  await page.getByLabel("确认密码", { exact: true }).fill(testPassword);
  await page.getByRole("button", { name: "注册并登录", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "退出登录", exact: true }),
  ).toBeVisible();
}
