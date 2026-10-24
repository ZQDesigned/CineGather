import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
const base = "http://127.0.0.1:14310/api/v1";
test("superadmin controls persistent registration while the public UI keeps existing login available", async ({
  page,
  browser,
}) => {
  const password = "Registration UI fixture 123!",
    username = `regui_${crypto.randomUUID().slice(0, 8)}`;
  const r = await page.request.post(base + "/accounts/register", {
    data: { username, displayName: "注册设置回归", password },
  });
  expect(r.ok()).toBe(true);
  const root = await r.json();
  execFileSync("bun", ["tools/superadmin.ts", "grant", root.user.id], {
    stdio: "pipe",
  });
  const guest = await browser.newContext();
  const visitor = await guest.newPage();
  try {
    await page.goto("/admin");
    await page.getByLabel("用户名", { exact: true }).fill(username);
    await page.getByLabel("密码", { exact: true }).fill(password);
    await page.getByRole("button", { name: "登录映聚", exact: true }).click();
    await page
      .getByRole("tab", { name: "注册设置", exact: true })
      .click({ timeout: 5000 });
    const toggle = page.getByRole("switch", { name: "开放注册", exact: true });
    const shareDefault = page.getByRole("switch", {
      name: "新注册用户默认允许屏幕共享",
      exact: true,
    });
    await expect(shareDefault).not.toBeChecked();
    await shareDefault.check();
    await expect(toggle).toBeChecked();
    await toggle.uncheck();
    await page
      .getByLabel("操作原因", { exact: true })
      .fill("暂时停止接受新账号");
    await page
      .getByRole("button", { name: "保存注册设置", exact: true })
      .click();
    await expect(
      page.getByText("注册设置已保存", { exact: true }),
    ).toBeVisible();
    await visitor.setViewportSize({ width: 980, height: 680 });
    await visitor.goto("/");
    await expect(
      visitor.getByText("当前暂未开放注册", { exact: true }),
    ).toBeVisible();
    await expect(
      visitor.getByRole("tab", { name: "注册", exact: true }),
    ).toBeDisabled();
    await expect(
      visitor.getByRole("button", { name: "登录映聚", exact: true }),
    ).toBeEnabled();
    expect(
      await visitor.evaluate(
        () => document.documentElement.scrollHeight <= innerHeight + 1,
      ),
    ).toBe(true);
    await visitor.getByLabel("用户名", { exact: true }).fill(username);
    await visitor.getByLabel("密码", { exact: true }).fill(password);
    await visitor
      .getByRole("button", { name: "登录映聚", exact: true })
      .click();
    await expect(visitor.locator(".home")).toBeVisible();
    await page.reload();
    await page.getByRole("tab", { name: "注册设置", exact: true }).click();
    await expect(toggle).not.toBeChecked();
    await expect(shareDefault).toBeChecked();
    await shareDefault.uncheck();
    await page.screenshot({
      path: ".local/capabilities-20261024/registration-capability.png",
    });
    await toggle.check();
    await page.getByLabel("操作原因", { exact: true }).fill("重新开放注册");
    await page
      .getByRole("button", { name: "保存注册设置", exact: true })
      .click();
    await expect(
      page.getByText("注册设置已保存", { exact: true }),
    ).toBeVisible();
    await visitor
      .getByRole("button", { name: "退出登录", exact: true })
      .click();
    await expect(
      visitor.getByRole("tab", { name: "注册", exact: true }),
    ).toBeEnabled();
    await visitor.getByRole("tab", { name: "注册", exact: true }).click();
    await visitor
      .getByLabel("用户名", { exact: true })
      .fill(username + "_late");
    await visitor.getByLabel("昵称", { exact: true }).fill("迟到的注册");
    await visitor.getByLabel("密码", { exact: true }).fill(password);
    await visitor.getByLabel("确认密码", { exact: true }).fill(password);
    await page.request.post(base + "/admin/registration", {
      headers: { Authorization: "Bearer " + root.sessionToken },
      data: { enabled: false, reason: "模拟提交前关闭" },
    });
    await visitor
      .getByRole("button", { name: "注册并登录", exact: true })
      .click();
    await expect(
      visitor.getByRole("tab", { name: "注册", exact: true }),
    ).toBeDisabled();
    await expect(
      visitor.getByRole("button", { name: "登录映聚", exact: true }),
    ).toBeVisible();
  } finally {
    await guest.close();
    execFileSync(
      "bun",
      ["tests/e2e/helpers/registration-cleanup.ts", root.user.id],
      { stdio: "pipe" },
    );
  }
});
test("policy network failure never opens registration and leaves login usable", async ({
  page,
}) => {
  await page.route("**/api/v1/registration", (route) => route.abort());
  await page.goto("/");
  await expect(
    page.getByText("暂时无法确认注册状态", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("tab", { name: "注册", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "登录映聚", exact: true }),
  ).toBeEnabled();
});
