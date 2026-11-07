import { test, expect } from "@playwright/test";
import { defaultSettings } from "../../apps/desktop/src/shared/settings";
import { execFileSync } from "node:child_process";

const cleanupIds: string[] = [];
test.afterEach(() => {
  if (cleanupIds.length)
    execFileSync(
      "bun",
      ["tests/e2e/helpers/cleanup-capabilities.ts", ...cleanupIds.splice(0)],
      { stdio: "pipe" },
    );
});

test("account capabilities use a single form and preserve cancellation and saved state", async ({
  page,
  browser,
}) => {
  const api = "http://127.0.0.1:14310/api/v1",
    suffix = crypto.randomUUID().slice(0, 8),
    password = "Capabilities browser 123!";
  const create = async (name: string) => {
    const r = await page.request.post(`${api}/accounts/register`, {
      data: {
        username: `capsui_${suffix}_${name}`,
        displayName: `能力界面${name}`,
        password,
      },
    });
    expect(r.status()).toBe(201);
    const data = await r.json();
    cleanupIds.push(data.user.id);
    return data;
  };
  const root = await create("root"),
    member = await create("member");
  execFileSync("bun", ["tools/operations/superadmin.ts", "grant", root.user.id], {
    stdio: "pipe",
  });
  await page.goto("/admin");
  await page.getByLabel("用户名", { exact: true }).fill(root.user.username);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录映聚", exact: true }).click();
  const row = page.getByRole("row").filter({ hasText: member.user.username });
  await row.getByRole("button", { name: "能力配置", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "账号能力配置" });
  await expect(
    dialog.getByRole("switch", { name: "1080p60 共享" }),
  ).not.toBeChecked();
  await dialog.getByRole("switch", { name: "1080p60 共享" }).click();
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await row.getByRole("button", { name: "能力配置", exact: true }).click();
  await expect(
    dialog.getByRole("switch", { name: "1080p60 共享" }),
  ).not.toBeChecked();
  await dialog.getByRole("switch", { name: "屏幕共享", exact: true }).click();
  await dialog.getByRole("switch", { name: "1080p60 共享" }).click();
  await dialog
    .getByRole("spinbutton", { name: "普通房创建人数上限" })
    .fill("25");
  await dialog.getByLabel("修改原因", { exact: true }).fill("统一能力界面验证");
  await page.route(
    "**/api/v1/admin/users/*/capabilities",
    (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          code: "TEST_UNAVAILABLE",
          message: "测试保存失败",
        }),
      }),
    { times: 1 },
  );
  await dialog.getByRole("button", { name: "保存配置", exact: true }).click();
  await expect(
    dialog.locator('button[form="account-capabilities"]'),
  ).not.toHaveClass(/ant-btn-loading/);
  await expect(
    dialog.getByRole("switch", { name: "1080p60 共享" }),
  ).toBeChecked();
  await expect(dialog.getByLabel("修改原因", { exact: true })).toHaveValue(
    "统一能力界面验证",
  );
  await page
    .getByRole("alert")
    .filter({ hasText: "测试保存失败" })
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  await dialog.getByRole("button", { name: "保存配置", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await row.getByRole("button", { name: "能力配置", exact: true }).click();
  await expect(
    dialog.getByRole("switch", { name: "1080p60 共享" }),
  ).toBeChecked();
  await expect(
    dialog.getByRole("spinbutton", { name: "普通房创建人数上限" }),
  ).toHaveValue("25");
  await page.setViewportSize({ width: 980, height: 720 });
  await expect(
    dialog.getByRole("button", { name: "保存配置", exact: true }),
  ).toBeInViewport();
  await dialog.evaluate((el) =>
    Promise.all(
      el
        .getAnimations({ subtree: true })
        .map((a) => a.finished.catch(() => {})),
    ),
  );
  await expect(page.getByText("账号能力已更新", { exact: true })).toBeHidden();
  await page.screenshot({ path: ".local/account-capabilities/admin-form.png" });
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  expect(
    (
      await page.request.patch(
        `${api}/admin/users/${member.user.id}/capabilities`,
        {
          headers: { Authorization: `Bearer ${root.sessionToken}` },
          data: { highFrameRateEnabled: false, reason: "画质回退验证" },
        },
      )
    ).status(),
  ).toBe(200);
  const client = await browser.newContext();
  try {
    await client.addInitScript(
      ({ token, settings }) => {
        localStorage.setItem("cinegather.session", token);
        localStorage.setItem("cinegather.settings", JSON.stringify(settings));
      },
      {
        token: member.sessionToken,
        settings: { ...defaultSettings, quality: "game" },
      },
    );
    const viewing = await client.newPage();
    await viewing.goto("/");
    await expect
      .poll(() =>
        viewing.evaluate(
          () =>
            JSON.parse(localStorage.getItem("cinegather.settings")!).quality,
        ),
      )
      .toBe("cinema");
    await viewing
      .getByRole("menuitem", { name: "设置与设备", exact: true })
      .click();
    await viewing
      .getByRole("tab", { name: "共享与快捷键", exact: true })
      .click();
    await viewing
      .getByRole("combobox", { name: "默认共享画质", exact: true })
      .click();
    await expect(
      viewing
        .locator(".ant-select-item-option-disabled")
        .filter({ hasText: "游戏" }),
    ).toContainText("需授权");
    await viewing
      .getByRole("dialog", { name: "设置与设备" })
      .getByText("设置与设备", { exact: true })
      .click();
    await viewing.getByRole("button", { name: "取消", exact: true }).click();
    await viewing
      .getByRole("button", { name: "创建私人房间", exact: true })
      .click();
    const create = viewing.getByRole("dialog");
    await create.getByLabel("房间人数", { exact: true }).click();
    await expect(viewing.getByText("25 人", { exact: true })).toBeVisible();
  } finally {
    await client.close();
  }
});
