import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
const api = "http://127.0.0.1:14310/api/v1";
test("superadmin grants roles; normal and limited administrators see only their authorized controls, with live revocation", async ({
  page,
  browser,
}) => {
  test.setTimeout(90000);
  const suffix = crypto.randomUUID().slice(0, 8),
    password = "Role browser test 123!";
  const register = async (label: string) => {
    const result = await page.request.post(`${api}/accounts/register`, {
      data: {
        username: `rolesui_${suffix}_${label}`,
        displayName: `角色界面${label}`,
        password,
      },
    });
    expect(result.ok()).toBe(true);
    return result.json();
  };
  const root = await register("root"),
    member = await register("member");
  execFileSync("bun", ["tools/superadmin.ts", "grant", root.user.id], {
    stdio: "pipe",
  });
  async function login(target: Page, user: { username: string }) {
    await target.goto(new URL("/admin", page.url()).href);
    await target.getByLabel("用户名", { exact: true }).fill(user.username);
    await target.getByLabel("密码", { exact: true }).fill(password);
    await target.getByRole("button", { name: "登录映聚", exact: true }).click();
    await expect(
      target.getByRole("heading", { name: "管理后台", exact: true }),
    ).toBeVisible();
  }
  await page.goto("/admin");
  await login(page, root.user);
  await page.getByRole("tab", { name: "角色管理", exact: true }).click();
  await expect(
    page.getByRole("row").filter({ hasText: "普通管理员" }),
  ).toContainText("内置");
  const roleName = `审计员 ${suffix}`;
  await page.getByRole("button", { name: "创建角色", exact: true }).click();
  await page.getByLabel("角色名称", { exact: true }).fill(roleName);
  await page
    .getByRole("checkbox", { name: "查看操作记录", exact: true })
    .check();
  await page.getByLabel("操作原因", { exact: true }).fill("创建审计员角色");
  await page.getByRole("button", { name: "保存角色", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("row").filter({ hasText: roleName }),
  ).toBeVisible();
  let assignedRole: string | undefined;
  async function editAssignment(role: string | undefined, reason: string) {
    await page.getByRole("tab", { name: "用户管理", exact: true }).click();
    const search = page.getByLabel("搜索管理数据", { exact: true });
    await search.fill(member.user.username);
    await search.press("Enter");
    const row = page.getByRole("row").filter({ hasText: member.user.username });
    await row.getByRole("button", { name: "分配角色", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("combobox", { name: "管理角色", exact: true }),
    ).toBeEnabled();
    if (assignedRole)
      await expect(
        dialog
          .locator(".ant-select-selection-item")
          .filter({ hasText: assignedRole }),
      ).toBeVisible();
    const removals = dialog.locator(".ant-select-selection-item-remove");
    while (await removals.count()) await removals.first().click();
    await expect(dialog.locator(".ant-select-selection-item")).toHaveCount(0);
    if (role) {
      await dialog
        .getByRole("combobox", { name: "管理角色", exact: true })
        .click();
      await page.getByRole("option", { name: role, exact: true }).click();
      await page.keyboard.press("Escape");
    }
    await dialog.getByLabel("操作原因", { exact: true }).fill(reason);
    await dialog.getByRole("button", { name: "保存授权", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    assignedRole = role;
    return row;
  }
  const assignedRow = await editAssignment("普通管理员", "授予普通管理员角色");
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await assignedRow
    .getByRole("button", { name: "复制用户 ID", exact: true })
    .click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    member.user.id,
  );
  const context = await browser.newContext();
  const viewer = await context.newPage();
  try {
    await login(viewer, member.user);
    await expect(
      viewer.getByRole("tab", { name: "用户管理", exact: true }),
    ).toBeVisible();
    await expect(
      viewer.getByRole("tab", { name: "房间管理", exact: true }),
    ).toBeVisible();
    await expect(
      viewer.getByRole("tab", { name: "角色管理", exact: true }),
    ).toHaveCount(0);
    await expect(
      viewer.getByRole("button", { name: "分配角色", exact: true }),
    ).toHaveCount(0);
    await editAssignment(roleName, "改为仅审计权限");
    await expect(
      viewer.getByRole("tab", { name: "用户管理", exact: true }),
    ).toHaveCount(0, { timeout: 10000 });
    await expect(
      viewer.getByRole("tab", { name: "操作记录", exact: true }),
    ).toBeVisible();
    await expect(viewer.getByText("注册账号", { exact: true })).toHaveCount(0);
    const token = await viewer.evaluate(() =>
      localStorage.getItem("cinegather.session"),
    );
    expect(
      (
        await viewer.request.get(`${api}/admin/users`, {
          headers: { Authorization: `Bearer ${token}` },
        })
      ).status(),
    ).toBe(403);
    await page.getByRole("tab", { name: "角色管理", exact: true }).click();
    const roleRow = page.getByRole("row").filter({ hasText: roleName });
    await roleRow.getByRole("button", { name: "编辑", exact: true }).click();
    await expect(page.getByLabel("角色名称", { exact: true })).toHaveValue(
      roleName,
    );
    await page
      .getByRole("checkbox", { name: "查看操作记录", exact: true })
      .uncheck();
    await page.getByRole("checkbox", { name: "查看房间", exact: true }).check();
    await page
      .getByLabel("操作原因", { exact: true })
      .fill("调整角色为房间查看");
    await page.getByRole("button", { name: "保存角色", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
      viewer.getByRole("tab", { name: "房间管理", exact: true }),
    ).toBeVisible({ timeout: 10000 });
    await expect(
      viewer.getByRole("tab", { name: "操作记录", exact: true }),
    ).toHaveCount(0);
    await expect(
      viewer.getByRole("button", { name: "关闭房间", exact: true }),
    ).toHaveCount(0);
    await page.setViewportSize({ width: 980, height: 680 });
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollHeight <= innerHeight &&
          document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({ path: ".local/rbac/roles-compact.png" });
    await viewer.screenshot({ path: ".local/rbac/limited-admin.png" });
    await roleRow.getByRole("button", { name: "编辑", exact: true }).click();
    await page
      .getByRole("checkbox", { name: "查看房间", exact: true })
      .uncheck();
    await page.getByRole("checkbox", { name: "查看概览", exact: true }).check();
    await page.getByLabel("操作原因", { exact: true }).fill("改为仅查看概览");
    await page.getByRole("button", { name: "保存角色", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
      viewer.getByRole("tab", { name: "概览", exact: true }),
    ).toBeVisible({ timeout: 10000 });
    await expect(viewer.getByText("注册账号", { exact: true })).toBeVisible();
    await expect(
      viewer.getByLabel("搜索管理数据", { exact: true }),
    ).toHaveCount(0);
    await editAssignment(undefined, "撤销所有管理角色");
    await expect(
      viewer.getByText("需要管理员权限", { exact: true }),
    ).toBeVisible({ timeout: 10000 });
    await expect(
      viewer.getByRole("menuitem", { name: "管理后台", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("tab", { name: "角色管理", exact: true }).click();
    await page.getByLabel("搜索管理数据", { exact: true }).fill(roleName);
    await page.getByLabel("搜索管理数据", { exact: true }).press("Enter");
    await page
      .getByRole("row")
      .filter({ hasText: roleName })
      .getByRole("button", { name: "删除", exact: true })
      .click();
    await page.getByLabel("操作原因", { exact: true }).fill("删除测试角色");
    await page.getByRole("button", { name: "确认删除", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
      page.getByRole("row").filter({ hasText: roleName }),
    ).toHaveCount(0);
  } finally {
    await context.close();
  }
});
