import { test, expect } from "@playwright/test";
test.use({ actionTimeout: 15000 });

test("room friends receive a real invitation, confirm switching rooms and join a password room without typing its password", async ({
  browser,
  request,
}) => {
  test.setTimeout(90000);
  const api = "http://127.0.0.1:14310/api/v1";
  const accounts: { user: { id: string }; sessionToken: string }[] = [];
  const contexts = [];
  const roomIds: string[] = [];
  try {
    for (const displayName of ["邀请发布端", "邀请接收端"]) {
      const response = await request.post(api + "/accounts/register", {
        data: {
          username:
            "ri_" + crypto.randomUUID().replaceAll("-", "").slice(0, 20),
          displayName,
          password: "Room invitation fixture 123!",
        },
      });
      expect(response.status()).toBe(201);
      accounts.push(await response.json());
      const context = await browser.newContext({ permissions: ["microphone"] });
      contexts.push(context);
      await context.addInitScript(
        (token) => localStorage.setItem("cinegather.session", token),
        accounts.at(-1)!.sessionToken,
      );
    }
    const headers = (index: number) => ({
      Authorization: `Bearer ${accounts[index]!.sessionToken}`,
    });
    await request.post(api + "/friends", {
      headers: headers(0),
      data: { userId: accounts[1]!.user.id },
    });
    await request.post(api + `/friends/${accounts[0]!.user.id}/accept`, {
      headers: headers(1),
    });
    const a = await contexts[0]!.newPage(),
      b = await contexts[1]!.newPage();
    for (const [index, page] of [a, b].entries()) {
      await page.goto("/");
      await page
        .getByRole("button", { name: "创建私人房间", exact: true })
        .click();
      await page
        .getByLabel("房间名称")
        .fill(index ? "接收端原房间" : "好友加密邀请房");
      if (!index) {
        await page.getByText("加密房", { exact: true }).click();
        await page
          .getByLabel("房间密码", { exact: true })
          .fill("secret-room-password");
      }
      await page
        .getByRole("button", { name: "创建并进入", exact: true })
        .click();
      await expect(page.locator(".connection")).toHaveText("已连接");
      roomIds.push(
        await page.evaluate(async () => {
          const { useApp } = await import("/store.ts" as string);
          return useApp.getState().room.id as string;
        }),
      );
    }
    await a.getByRole("button", { name: "邀请朋友", exact: true }).click();
    const invite = a.getByRole("dialog");
    await invite.getByRole("tab", { name: "邀请好友", exact: true }).click();
    await invite
      .getByRole("button", { name: "邀请邀请接收端加入房间", exact: true })
      .click();
    await expect(
      invite.getByRole("button", { name: "已邀请邀请接收端", exact: true }),
    ).toBeDisabled();
    await b.getByRole("menuitem", { name: "好友", exact: true }).click();
    await expect(b.locator(".friend small")).toHaveText("房间中（1/5）", {
      timeout: 15000,
    });
    await expect(b.locator(".ant-notification")).toContainText("邀请发布端", {
      timeout: 15000,
    });
    await b.getByRole("button", { name: "房间邀请", exact: true }).click();
    const inbox = b.getByRole("dialog", { name: "房间邀请", exact: true });
    await expect(inbox).toContainText("好友加密邀请房");
    await inbox.getByRole("button", { name: "加入房间", exact: true }).click();
    await expect(
      b.getByRole("dialog").filter({ hasText: "切换房间" }),
    ).toBeVisible();
    await b.getByRole("button", { name: "取消", exact: true }).click();
    await expect(b.locator(".current-room")).toContainText("接收端原房间");
    await inbox.getByRole("button", { name: "加入房间", exact: true }).click();
    await b.getByRole("button", { name: "离开并加入", exact: true }).click();
    await expect(b.locator(".room-heading h1")).toHaveText("好友加密邀请房");
    await expect(a.locator(".members-list .member")).toHaveCount(2);
    await expect(b.getByLabel("房间密码", { exact: true })).toHaveCount(0);
    await expect(
      b.getByRole("button", { name: "房间邀请", exact: true }),
    ).toHaveCount(0);
    await a.getByRole("button", { name: "关闭对话框", exact: true }).click();
    await b.getByRole("menuitem", { name: "好友", exact: true }).click();
    await expect(b.locator(".friend small")).toHaveText("房间中（2/5）", {
      timeout: 15000,
    });
    await a.getByRole("button", { name: "设置在线状态", exact: true }).click();
    await a.getByRole("menuitem", { name: "隐身", exact: true }).click();
    await expect(b.locator(".friend small")).toHaveText("离线", {
      timeout: 15000,
    });
    await a.getByRole("button", { name: "设置在线状态", exact: true }).click();
    await a.getByRole("menuitem", { name: "在线", exact: true }).click();
    await expect(b.locator(".friend small")).toHaveText("房间中（2/5）", {
      timeout: 15000,
    });
    await a.getByRole("button", { name: "离开房间", exact: true }).click();
    await expect(b.locator(".friend small")).toHaveText("在线", {
      timeout: 15000,
    });
    await b.getByRole("button", { name: "退出当前房间", exact: true }).click();
  } finally {
    await Promise.allSettled(contexts.map((context) => context.close()));
    const { execFileSync } = await import("node:child_process");
    if (accounts.length)
      execFileSync(
        "bun",
        [
          "tests/e2e/helpers/cleanup-room-invitations.ts",
          JSON.stringify({
            users: accounts.map((a) => a.user.id),
            rooms: roomIds,
          }),
        ],
        { stdio: "pipe" },
      );
  }
});
