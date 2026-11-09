import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";

test("long account names never push the account menu outside the sidebar at supported window sizes", async ({
  page,
  request,
}) => {
  const response = await request.post(
    "http://127.0.0.1:14310/api/v1/accounts/register",
    {
      data: {
        username:
          "profile_" + crypto.randomUUID().replaceAll("-", "").slice(0, 24),
        displayName: "昵称".repeat(16),
        password: "Profile regression password 123!",
      },
    },
  );
  expect(response.status()).toBe(201);
  const account = await response.json();
  try {
    await page.addInitScript(
      (token) => localStorage.setItem("cinegather.session", token),
      account.sessionToken,
    );
    await page.goto("/");
    const menuTrigger = page.getByRole("button", {
      name: "账户菜单",
      exact: true,
    });
    await menuTrigger.waitFor();
    await expect(page.locator(".profile-name")).toHaveText("昵称".repeat(16));
    await expect(page.locator(".sidebar-bottom")).not.toContainText(
      /设置与设备|连接诊断/,
    );
    for (const width of [760, 980, 1100, 1440]) {
      await page.setViewportSize({ width, height: 700 });
      const bounds = await page.locator(".profile").evaluate((element) => ({
        width: element.clientWidth,
        scroll: element.scrollWidth,
      }));
      expect(bounds.scroll).toBeLessThanOrEqual(bounds.width);
      const sidebar = (await page.locator(".sidebar").boundingBox())!;
      const button = (await menuTrigger.boundingBox())!;
      expect(button.x + button.width).toBeLessThanOrEqual(
        sidebar.x + sidebar.width - 8,
      );
      await expect(menuTrigger).toBeInViewport({ ratio: 1 });
    }
    await menuTrigger.click();
    for (const name of ["设置与设备", "连接诊断", "退出登录"])
      await expect(
        page.getByRole("menuitem", { name, exact: true }),
      ).toBeVisible();
    await page.screenshot({
      path: ".local/friend-experience/sidebar-profile.png",
    });
    await page.keyboard.press("Escape");
    await expect(menuTrigger).toHaveAttribute("aria-expanded", "false");
    await expect(menuTrigger).toBeFocused();
  } finally {
    await page.goto("about:blank");
    execFileSync(
      "bun",
      ["tests/e2e/helpers/cleanup-social.ts", account.user.id],
      { stdio: "pipe" },
    );
  }
});
