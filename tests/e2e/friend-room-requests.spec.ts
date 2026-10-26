import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
test.use({ actionTimeout: 15000 });
for (const decision of ["同意", "拒绝"] as const) {
  test(`friends can request a room, while invisible room members remain offline, and their friend can ${decision}`, async ({
    browser,
    request,
  }) => {
    test.setTimeout(90000);
    const api = "http://127.0.0.1:14310/api/v1";
    const accounts: { user: { id: string }; sessionToken: string }[] = [],
      contexts = [],
      roomIds: string[] = [];
    try {
      for (const name of ["处理申请好友", "申请入房好友", "占位成员"]) {
        const response = await request.post(api + "/accounts/register", {
          data: {
            username:
              "jr_" + crypto.randomUUID().replaceAll("-", "").slice(0, 20),
            displayName: name,
            password: "Join request fixture 123!",
          },
        });
        expect(response.status()).toBe(201);
        accounts.push(await response.json());
      }
      const headers = (i: number) => ({
        Authorization: `Bearer ${accounts[i]!.sessionToken}`,
      });
      await request.post(api + "/friends", {
        headers: headers(0),
        data: { userId: accounts[1]!.user.id },
      });
      await request.post(api + `/friends/${accounts[0]!.user.id}/accept`, {
        headers: headers(1),
      });
      for (const account of accounts.slice(0, 2)) {
        const context = await browser.newContext({
          permissions: ["microphone"],
        });
        contexts.push(context);
        await context.addInitScript(
          (token) => localStorage.setItem("cinegather.session", token),
          account.sessionToken,
        );
      }
      const a = await contexts[0]!.newPage(),
        b = await contexts[1]!.newPage();
      await a.goto("/");
      await b.goto("/");
      await a
        .getByRole("button", { name: "创建私人房间", exact: true })
        .click();
      await a.getByLabel("房间名称").fill("好友入房审批");
      await a.getByText("加密房", { exact: true }).click();
      await a
        .getByLabel("房间密码", { exact: true })
        .fill("request-room-password");
      await a.getByRole("button", { name: "创建并进入", exact: true }).click();
      await expect(a.locator(".connection")).toHaveText("已连接");
      const roomId = await a.evaluate(async () => {
        const { useApp } = await import("/store.ts" as string);
        return useApp.getState().room.id as string;
      });
      roomIds.push(roomId);
      // Full capacity uses real admissions; the UI must report rather than silently fail.
      const resize = await request.post(api + `/rooms/${roomId}/settings`, {
        headers: headers(0),
        data: { maxMembers: 2 },
      });
      expect(resize.ok()).toBe(true);
      await request.post(api + `/rooms/${roomId}/join`, {
        headers: headers(2),
        data: { password: "request-room-password" },
      });
      await a
        .getByRole("button", { name: "设置在线状态", exact: true })
        .click();
      await a.getByRole("menuitem", { name: "隐身", exact: true }).click();
      await b.getByRole("menuitem", { name: "好友", exact: true }).click();
      await expect(b.locator(".friend small")).toHaveText("离线", {
        timeout: 15000,
      });
      await expect(
        b.getByRole("button", { name: "申请加入", exact: true }),
      ).toHaveCount(0);
      const hidden = await request.post(
        api + `/friends/${accounts[0]!.user.id}/room-requests`,
        { headers: headers(1), data: {} },
      );
      expect(hidden.status()).toBe(409);
      await a
        .getByRole("button", { name: "设置在线状态", exact: true })
        .click();
      await a.getByRole("menuitem", { name: "在线", exact: true }).click();
      await expect(b.locator(".friend small")).toHaveText("房间中（2/2）", {
        timeout: 15000,
      });
      await b.getByRole("button", { name: "申请加入", exact: true }).click();
      await expect(b.locator(".ant-notification")).toContainText(
        "房间已满，无法加入",
      );
      await request.post(api + `/rooms/${roomId}/leave`, {
        headers: headers(2),
        data: {},
      });
      await expect(b.locator(".friend small")).toHaveText("房间中（1/2）", {
        timeout: 15000,
      });
      await b.getByRole("button", { name: "申请加入", exact: true }).click();
      await expect(
        b.getByRole("button", { name: "等待好友处理", exact: true }),
      ).toBeDisabled();
      await a
        .getByRole("button", { name: "入房申请", exact: true })
        .click({ timeout: 15000 });
      const inbox = a.getByRole("dialog", { name: "入房申请", exact: true });
      await expect(inbox).toContainText("申请入房好友");
      await inbox.getByRole("button", { name: decision, exact: true }).click();
      if (decision === "同意") {
        await expect(b.locator(".ant-notification")).toContainText(
          "已同意你的入房申请",
          { timeout: 15000 },
        );
        await b.getByRole("button", { name: "房间邀请", exact: true }).click();
        await b
          .getByRole("dialog", { name: "房间邀请", exact: true })
          .getByRole("button", { name: "加入房间", exact: true })
          .click();
        await expect(b.locator(".room-heading h1")).toHaveText("好友入房审批");
        await expect(b.getByLabel("房间密码", { exact: true })).toHaveCount(0);
        await b.getByRole("button", { name: "离开房间", exact: true }).click();
      } else {
        await expect(b.locator(".ant-notification")).toContainText(
          "拒绝了你的入房申请",
          { timeout: 15000 },
        );
        await expect(
          b.getByRole("button", { name: "等待好友处理", exact: true }),
        ).toHaveCount(0);
        await expect(
          b.getByRole("button", { name: "房间邀请", exact: true }),
        ).toHaveCount(0);
      }
      await a.getByRole("button", { name: "关闭对话框", exact: true }).click();
      await b.getByRole("menuitem", { name: "好友", exact: true }).click();
      await a
        .getByRole("button", { name: "设置在线状态", exact: true })
        .click();
      await a.getByRole("menuitem", { name: "隐身", exact: true }).click();
      await expect(b.locator(".friend small")).toHaveText("离线", {
        timeout: 15000,
      });
      await expect(
        b.getByRole("button", { name: "申请加入", exact: true }),
      ).toHaveCount(0);

      await a.getByRole("button", { name: "离开房间", exact: true }).click();
      await b.getByRole("menuitem", { name: "好友", exact: true }).click();
      await expect(b.locator(".friend small")).toHaveText("离线", {
        timeout: 15000,
      });
    } finally {
      await Promise.allSettled(contexts.map((c) => c.close()));
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
}
