import { test, expect, _electron } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
const executable = resolve(
  "apps/desktop/release/mac-arm64/CineGather.app/Contents/MacOS/CineGather",
);
test("packaged superadmin uses the shared role editor, preserves edit fields and fits the minimum window", async ({
  request,
}) => {
  test.skip(
    process.platform !== "darwin" || !existsSync(executable),
    "Requires local Mac package",
  );
  const api = "http://127.0.0.1:14310/api/v1",
    suffix = crypto.randomUUID().slice(0, 8),
    username = `macroot_${suffix}`,
    password = "Mac roles test password 123!";
  const response = await request.post(`${api}/accounts/register`, {
    data: { username, displayName: "Mac 角色管理员", password },
  });
  expect(response.ok()).toBe(true);
  const account = await response.json();
  execFileSync("bun", ["tools/superadmin.ts", "grant", account.user.id], {
    stdio: "pipe",
  });
  const profile = await mkdtemp(join(tmpdir(), "cg-admin-roles-"));
  const app = await _electron.launch({
    executablePath: executable,
    args: [`--user-data-dir=${profile}`],
  });
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]!;
      win.setSize(980, 680);
      win.show();
      win.focus();
    });
    await page.getByLabel("用户名", { exact: true }).fill(username);
    await page.getByLabel("密码", { exact: true }).fill(password);
    await page.getByRole("button", { name: "登录映聚", exact: true }).click();
    await page.getByRole("menuitem", { name: "管理后台", exact: true }).click();
    await page.getByRole("tab", { name: "角色管理", exact: true }).click();
    const roleName = `Mac 审计 ${suffix}`;
    await page.getByRole("button", { name: "创建角色", exact: true }).click();
    await page.getByLabel("角色名称", { exact: true }).fill(roleName);
    await page
      .getByRole("checkbox", { name: "查看操作记录", exact: true })
      .check();
    await page.getByLabel("操作原因", { exact: true }).fill("桌面角色创建验证");
    await page.getByRole("button", { name: "保存角色", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const row = page.getByRole("row").filter({ hasText: roleName });
    await row.getByRole("button", { name: "编辑", exact: true }).click();
    await expect(page.getByLabel("角色名称", { exact: true })).toHaveValue(
      roleName,
    );
    await expect(
      page.getByRole("checkbox", { name: "查看操作记录", exact: true }),
    ).toBeChecked();
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollHeight <= innerHeight &&
          document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({ path: ".local/rbac/mac-role-management.png" });
    await row.getByRole("button", { name: "删除", exact: true }).click();
    await page.getByLabel("操作原因", { exact: true }).fill("桌面删除测试角色");
    await page.getByRole("button", { name: "确认删除", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(row).toHaveCount(0);
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true });
  }
});
