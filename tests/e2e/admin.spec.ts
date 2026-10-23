import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { registerTestAccount } from "./helpers/account";
const api = "http://127.0.0.1:14310/api/v1";
test("account-only onboarding and ordinary-user admin denial", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "访客体验", exact: true }),
  ).toHaveCount(0);
  await registerTestAccount(page, "普通账号管理权限");
  await expect(
    page.getByRole("menuitem", { name: "管理后台", exact: true }),
  ).toHaveCount(0);
  await page.goto("/admin");
  await expect(page.getByText("需要管理员权限", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "返回放映厅", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "晚上好，普通账号管理权限" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "晚上好，普通账号管理权限" }),
  ).toBeVisible();
});
test("admin can search users, confirm account actions, close rooms and inspect audit at compact size", async ({
  page,
}) => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const password = "Admin browser fixture 123!";
  const create = async (name: string) => {
    const res = await page.request.post(`${api}/accounts/register`, {
      data: {
        username: `adminui_${suffix}_${name}`,
        displayName: `管理界面${name}`,
        password,
      },
    });
    expect(res.ok()).toBe(true);
    return res.json();
  };
  const administrator = await create("owner"),
    member = await create("member");
  execFileSync("bun", ["tools/superadmin.ts", "grant", administrator.user.id], {
    stdio: "pipe",
  });
  const headers = { Authorization: `Bearer ${member.sessionToken}` };
  const room = await (
    await page.request.post(`${api}/rooms`, {
      headers,
      data: { name: `管理关闭${suffix}` },
    })
  ).json();
  await page.goto("/admin");
  await page
    .getByLabel("用户名", { exact: true })
    .fill(administrator.user.username);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录映聚", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "管理后台", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("row").filter({ hasText: member.user.username }),
  ).toBeVisible();
  await page.screenshot({ path: ".local/admin-account-only/admin-users.png" });
  await page.setViewportSize({ width: 980, height: 680 });
  const search = page.getByLabel("搜索管理数据", { exact: true });
  await search.fill(member.user.username);
  await search.press("Enter");
  const row = page.getByRole("row").filter({ hasText: member.user.username });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "停用", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect((await page.request.get(`${api}/me`, { headers })).ok()).toBe(true);
  await row.getByRole("button", { name: "停用", exact: true }).click();
  await page.getByLabel("操作原因", { exact: true }).fill("界面停用验证");
  await page.getByRole("button", { name: "确认操作", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(row).toContainText("已停用");
  expect((await page.request.get(`${api}/me`, { headers })).status()).toBe(401);
  await row.getByRole("button", { name: "启用", exact: true }).click();
  await page.getByLabel("操作原因", { exact: true }).fill("界面恢复验证");
  await page.getByRole("button", { name: "确认操作", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(row).toContainText("正常");
  const logged = await (
    await page.request.post(`${api}/accounts/login`, {
      data: { username: member.user.username, password },
    })
  ).json();
  const next = await (
    await page.request.post(`${api}/rooms`, {
      headers: { Authorization: `Bearer ${logged.sessionToken}` },
      data: { name: `管理关闭${suffix}` },
    })
  ).json();
  await page.getByRole("tab", { name: "房间管理", exact: true }).click();
  await search.fill(next.code);
  await search.press("Enter");
  const roomRow = page.getByRole("row").filter({ hasText: next.code });
  await roomRow.getByRole("button", { name: "关闭房间", exact: true }).click();
  await page.getByLabel("操作原因", { exact: true }).fill("界面关闭验证");
  await page.getByRole("button", { name: "确认操作", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(roomRow).toContainText("已关闭");
  expect(
    (
      await page.request.get(`${api}/rooms/${next.id}`, {
        headers: { Authorization: `Bearer ${logged.sessionToken}` },
      })
    ).status(),
  ).toBe(404);
  await page.getByRole("tab", { name: "操作记录", exact: true }).click();
  await search.fill(next.code);
  await search.press("Enter");
  await expect(
    page
      .getByRole("row")
      .filter({ hasText: next.code })
      .filter({ hasText: "界面关闭验证" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollHeight <= innerHeight &&
        document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: ".local/admin-account-only/admin-audit-compact.png",
  });
  // First room is closed by disabling its sole member, without manual room deletion.
  expect(
    (
      await page.request.get(`${api}/rooms/${room.id}`, {
        headers: { Authorization: `Bearer ${logged.sessionToken}` },
      })
    ).status(),
  ).toBe(404);
});

test("disabling an account removes its live media and explains why it must log in again", async ({
  page,
}) => {
  await page.goto("/");
  await registerTestAccount(page, "停用中的在线账号");
  const bearer = await page.evaluate(() =>
    localStorage.getItem("cinegather.session"),
  );
  const person = await (
    await page.request.get(`${api}/me`, {
      headers: { Authorization: `Bearer ${bearer}` },
    })
  ).json();
  const username = `liveadmin_${crypto.randomUUID().slice(0, 8)}`;
  const administrator = await (
    await page.request.post(`${api}/accounts/register`, {
      data: {
        username,
        displayName: "在线停用管理员",
        password: "Live admin test 123!",
      },
    })
  ).json();
  execFileSync("bun", ["tools/superadmin.ts", "grant", administrator.user.id], {
    stdio: "pipe",
  });
  await page.getByRole("button", { name: "创建私人房间", exact: true }).click();
  await page.getByLabel("房间名称").fill("在线停用验证");
  await page.getByRole("button", { name: "创建并进入", exact: true }).click();
  await expect(page.locator(".connection")).toContainText("已连接");
  const disabled = await page.request.post(
    `${api}/admin/users/${person.id}/disable`,
    {
      headers: { Authorization: `Bearer ${administrator.sessionToken}` },
      data: { reason: "在线停用验证" },
    },
  );
  expect(disabled.ok()).toBe(true);
  await expect(
    page.getByRole("tab", { name: "登录", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".ant-notification-notice-error")).toContainText(
    "账号已停用",
  );
  await expect(page.locator(".room-slot")).toHaveCount(0);
});
