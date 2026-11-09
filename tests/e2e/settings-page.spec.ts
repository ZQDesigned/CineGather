import { test, expect } from "@playwright/test";

test("settings are a full page before login; save stays on the page and restore discards edits", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("menuitem", { name: "设置与设备", exact: true }).click();
  const settings = page.getByRole("region", {
    name: "设置与设备页面",
    exact: true,
  });
  await expect(settings).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).toHaveURL(/#\/settings/);
  const noise = settings.getByRole("combobox", {
    name: "麦克风降噪",
    exact: true,
  });
  const select = settings.locator(".ant-select").filter({
    has: page.getByRole("combobox", { name: "麦克风降噪", exact: true }),
  });
  await expect(select).toContainText("基础降噪");
  await noise.click();
  await page.getByRole("option", { name: "关闭降噪", exact: true }).click();
  await settings.getByRole("button", { name: "还原更改", exact: true }).click();
  await expect(select).toContainText("基础降噪");
  await noise.click();
  await page.getByRole("option", { name: "关闭降噪", exact: true }).click();
  await settings.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect(settings).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("cinegather.settings")!)
            .noiseReduction,
      ),
    )
    .toBe("off");
  // The success message must not turn its transparent width into a click shield.
  await page.getByRole("status").filter({ hasText: "设置已保存" }).waitFor();
  expect(
    await settings
      .getByRole("button", { name: "保存设置", exact: true })
      .evaluate((button) => {
        const rect = button.getBoundingClientRect();
        return button.contains(
          document.elementFromPoint(
            rect.x + rect.width / 2,
            rect.y + rect.height / 2,
          ),
        );
      }),
  ).toBe(true);
  await settings
    .getByRole("button", { name: "保存设置", exact: true })
    .click({ timeout: 5000 });
  await page.reload();
  await expect(settings).toBeVisible();
  await expect(select).toContainText("关闭降噪");
  await settings.getByRole("tab", { name: "通知", exact: true }).click();
  await page.reload();
  await expect(
    settings.getByRole("tab", { name: "通知", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.getByRole("menuitem", { name: /我的房间/ }).click();
  await expect(settings).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "登录映聚", exact: true }),
  ).toBeVisible();
});

test("the login server shortcut opens the full-page server tab and verification does not navigate away", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "连接自托管服务器", exact: true })
    .click();
  const settings = page.getByRole("region", {
    name: "设置与设备页面",
    exact: true,
  });
  await expect(settings).toBeVisible();
  await expect(
    settings.getByRole("tab", { name: "自托管服务器", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await settings.getByRole("button", { name: "保存地址", exact: true }).click();
  await expect(page.getByText("服务器连接正常", { exact: true })).toBeVisible();
  await expect(settings).toBeVisible();
});
