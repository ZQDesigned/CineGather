import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";

test("accepted friends see online state while invisibility survives a reload and logout removes presence", async ({
  browser,
  request,
}) => {
  const api = "http://127.0.0.1:14310/api/v1";
  const accounts: {
    user: { id: string; displayName: string };
    sessionToken: string;
  }[] = [];
  const contexts = [];
  try {
    for (const name of ["在线状态甲", "在线状态乙"]) {
      const response = await request.post(api + "/accounts/register", {
        data: {
          username:
            "pr_" + crypto.randomUUID().replaceAll("-", "").slice(0, 20),
          displayName: name,
          password: "Presence fixture password 123!",
        },
      });
      expect(response.status()).toBe(201);
      accounts.push(await response.json());
    }
    const headers = (index: number) => ({
      Authorization: `Bearer ${accounts[index]!.sessionToken}`,
    });
    expect(
      (
        await request.post(api + "/friends", {
          headers: headers(0),
          data: { userId: accounts[1]!.user.id },
        })
      ).status(),
    ).toBe(201);
    expect(
      (
        await request.post(api + `/friends/${accounts[0]!.user.id}/accept`, {
          headers: headers(1),
        })
      ).status(),
    ).toBe(201);
    for (const account of accounts) {
      const context = await browser.newContext();
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
    await expect(
      b.getByRole("button", { name: "设置在线状态", exact: true }),
    ).toBeVisible();
    await a.getByRole("menuitem", { name: "好友", exact: true }).click();
    const friend = a.locator(".friend").filter({ hasText: "在线状态乙" });
    await expect(friend.locator("small")).toHaveText("在线", {
      timeout: 10000,
    });
    await b.getByRole("button", { name: "设置在线状态", exact: true }).click();
    await b.getByRole("menuitem", { name: "隐身", exact: true }).click();
    await expect(friend.locator("small")).toHaveText("离线", {
      timeout: 10000,
    });
    await b.reload();
    await b.getByRole("menuitem", { name: "好友", exact: true }).click();
    await expect(
      b
        .locator(".ant-select")
        .filter({ has: b.getByLabel("我的在线状态", { exact: true }) }),
    ).toContainText("隐身");
    await b.getByLabel("我的在线状态", { exact: true }).click();
    await b.getByTitle("在线", { exact: true }).click();
    await expect(friend.locator("small")).toHaveText("在线", {
      timeout: 10000,
    });
    await b.keyboard.press("Escape");
    await b.getByRole("button", { name: "退出登录", exact: true }).click();
    await expect(friend.locator("small")).toHaveText("离线", {
      timeout: 10000,
    });
  } finally {
    for (const context of contexts) await context.close();
    if (accounts.length)
      execFileSync(
        "bun",
        [
          "tests/e2e/helpers/cleanup-social.ts",
          ...accounts.map((a) => a.user.id),
        ],
        { stdio: "pipe" },
      );
  }
});
