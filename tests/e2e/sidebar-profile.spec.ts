import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";

test("long account names never push logout outside the sidebar at supported window sizes", async ({
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
    const logout = page.getByRole("button", { name: "退出登录", exact: true });
    await logout.waitFor();
    for (const width of [760, 980, 1100, 1440]) {
      await page.setViewportSize({ width, height: 700 });
      const bounds = await page.locator(".profile").evaluate((element) => ({
        width: element.clientWidth,
        scroll: element.scrollWidth,
      }));
      expect(bounds.scroll).toBeLessThanOrEqual(bounds.width);
      const sidebar = (await page.locator(".sidebar").boundingBox())!;
      const button = (await logout.boundingBox())!;
      expect(button.x + button.width).toBeLessThanOrEqual(
        sidebar.x + sidebar.width - 8,
      );
      await expect(logout).toBeInViewport({ ratio: 1 });
    }
    await page.screenshot({
      path: ".local/friend-experience/sidebar-profile.png",
    });
  } finally {
    await page.goto("about:blank");
    execFileSync(
      "bun",
      ["tests/e2e/helpers/cleanup-social.ts", account.user.id],
      { stdio: "pipe" },
    );
  }
});
