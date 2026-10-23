import { registerTestAccount } from "./helpers/account";
import { test, expect, type Page } from "@playwright/test";
async function userId(page: Page) {
  const token = await page.evaluate(() =>
    localStorage.getItem("cinegather.session"),
  );
  const result = await page.request.get("http://127.0.0.1:14310/api/v1/me", {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(result.ok()).toBe(true);
  return (await result.json()).id as string;
}
async function temporary(page: Page, name: string) {
  await page.goto("/");
  await registerTestAccount(page, name);
  await expect(
    page.getByRole("heading", { name: `晚上好，${name}` }),
  ).toBeVisible();
}
async function register(page: Page, username: string) {
  await page.goto("/");
  await page.getByRole("tab", { name: "注册", exact: true }).click();
  await page.getByLabel("用户名", { exact: true }).fill(username);
  await page.getByLabel("昵称", { exact: true }).fill("长期观众");
  await page
    .getByLabel("密码", { exact: true })
    .fill("Local test password 123!");
  await page
    .getByLabel("确认密码", { exact: true })
    .fill("Local test password 123!");
  await page.getByRole("button", { name: "注册并登录", exact: true }).click();
}
test("account login is the primary entrance, removed captions stay absent, and identity survives logout and login", async ({
  page,
}) => {
  const username = `ui_${crypto.randomUUID().slice(0, 8)}`;
  await register(page, username);
  await expect(
    page.getByRole("heading", { name: "晚上好，长期观众" }),
  ).toBeVisible();
  const id = await userId(page);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "晚上好，长期观众" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(
    page.getByRole("tab", { name: "登录", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "访客体验", exact: true }),
  ).toHaveCount(0);
  for (const text of [
    "YOUR PEOPLE. YOUR CINEMA.",
    "今晚的相聚，从这里开始",
    "LET’S WATCH TOGETHER",
  ])
    await expect(page.getByText(text, { exact: true })).toHaveCount(0);
  await page.getByLabel("用户名", { exact: true }).fill(username.toUpperCase());
  await page
    .getByLabel("密码", { exact: true })
    .fill("Local test password 123!");
  await page.getByRole("button", { name: "登录映聚", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "晚上好，长期观众" }),
  ).toBeVisible();
  expect(await userId(page)).toBe(id);
  await page.setViewportSize({ width: 980, height: 680 });
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await page.getByRole("tab", { name: "注册", exact: true }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollHeight <= innerHeight,
    ),
  ).toBe(true);
});
test("registered accounts support password changes in the shared settings UI", async ({
  page,
}) => {
  await temporary(page, "账号安全验证");
  await page.getByRole("button", { name: "创建私人房间", exact: true }).click();
  await page.getByLabel("房间名称").fill("账号安全保留房间");
  await page.getByRole("button", { name: "创建并进入", exact: true }).click();
  await expect(page.locator(".connection")).toContainText("已连接");
  await page.getByRole("menuitem", { name: "设置与设备", exact: true }).click();
  await page.getByRole("tab", { name: "账号与安全", exact: true }).click();
  await page
    .getByLabel("当前密码", { exact: true })
    .fill("Incorrect current password!");
  await page
    .getByLabel("新密码", { exact: true })
    .fill("New local test password 456!");
  await page
    .getByLabel("确认密码", { exact: true })
    .fill("New local test password 456!");
  await page.getByRole("button", { name: "修改密码", exact: true }).click();
  await expect(page.locator(".ant-notification-notice-error")).toContainText(
    "当前密码不正确",
  );
  await expect(page.locator(".connection")).toContainText("已连接");
  await page
    .getByLabel("当前密码", { exact: true })
    .fill("Local test password 123!");
  await page.getByRole("button", { name: "修改密码", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "退出登录", exact: true }),
  ).toBeVisible();
});
test("room ownership follows present clients and the final departure removes the room from all lobbies", async ({
  page,
  browser,
}) => {
  await temporary(page, "离开的房主");
  await page.getByRole("button", { name: "创建私人房间", exact: true }).click();
  await page.getByLabel("房间名称").fill("转交与销毁");
  await page.getByRole("button", { name: "创建并进入" }).click();
  await page.getByRole("button", { name: "关闭麦克风", exact: true }).waitFor();
  const code = (
    await page
      .getByRole("button", { name: "复制房间号", exact: true })
      .innerText()
  ).trim();
  const context = await browser.newContext({ permissions: ["microphone"] });
  const friend = await context.newPage();
  try {
    await temporary(friend, "接任的房主");
    await friend.getByRole("button", { name: "加入房间", exact: true }).click();
    await friend.getByLabel("房间号或邀请链接").fill(code);
    await friend.getByRole("button", { name: "进入房间", exact: true }).click();
    await expect(page.locator(".members-list .member")).toHaveCount(2);
    await page.getByRole("button", { name: "离开房间", exact: true }).click();
    await expect(
      friend.getByRole("button", { name: "邀请朋友", exact: true }),
    ).toBeVisible();
    await expect(
      friend.locator(".member").filter({ hasText: "接任的房主" }),
    ).toContainText("房主");
    await friend.getByRole("button", { name: "离开房间", exact: true }).click();
    await expect(
      friend.locator(".room-card").filter({ hasText: "转交与销毁" }),
    ).toHaveCount(0);
    await expect(
      page.locator(".room-card").filter({ hasText: "转交与销毁" }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "加入房间", exact: true }).click();
    await page.getByLabel("房间号或邀请链接").fill(code);
    await page.getByRole("button", { name: "进入房间", exact: true }).click();
    await expect(page.locator(".ant-notification-notice-error")).toContainText(
      "房间不存在或已关闭",
    );
  } finally {
    await context.close();
  }
});
