import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";

test("search a unique username, confirm the result and accept the friend request without copying IDs", async ({
  browser,
  request,
}) => {
  const accounts: {
    user: { id: string; username: string };
    sessionToken: string;
  }[] = [];
  const contexts = [];
  try {
    for (let index = 0; index < 2; index++) {
      const response = await request.post(
        "http://127.0.0.1:14310/api/v1/accounts/register",
        {
          data: {
            username:
              "search_" + crypto.randomUUID().replaceAll("-", "").slice(0, 20),
            displayName: "同名好友",
            password: "Friend search fixture password 123!",
          },
        },
      );
      expect(response.status()).toBe(201);
      accounts.push(await response.json());
      const context = await browser.newContext();
      contexts.push(context);
      await context.addInitScript(
        (token) => localStorage.setItem("cinegather.session", token),
        accounts[index]!.sessionToken,
      );
    }
    const a = await contexts[0]!.newPage(),
      b = await contexts[1]!.newPage();
    for (const page of [a, b]) {
      await page.goto("/");
      await page.getByRole("menuitem", { name: "好友", exact: true }).click();
      await expect(page.getByText("我的用户 ID", { exact: true })).toHaveCount(
        0,
      );
      await expect(
        page.getByRole("button", { name: "复制我的用户 ID", exact: true }),
      ).toHaveCount(0);
    }
    await expect(
      a.getByRole("tab", { name: "添加好友", exact: true }),
    ).toHaveCount(0);
    await a.getByRole("button", { name: "添加好友", exact: true }).click();
    await expect(
      a.getByRole("dialog", { name: "添加好友", exact: true }),
    ).toBeVisible();
    await b.getByRole("tab", { name: /^好友申请/ }).click();
    const input = a.getByRole("textbox", { name: "好友用户名", exact: true });
    await input.fill(accounts[1]!.user.username.toUpperCase());
    await a.getByRole("button", { name: "搜索", exact: true }).click();
    const result = a.getByRole("region", { name: "搜索结果", exact: true });
    await expect(result).toContainText(accounts[1]!.user.username);
    await expect(result).toContainText("同名好友");
    await expect(a.locator(".friends-list .friend")).toHaveCount(0);
    await result
      .getByRole("button", { name: "发送好友请求", exact: true })
      .click();
    await expect(
      result.getByRole("button", { name: "等待对方接受", exact: true }),
    ).toBeDisabled();
    await b
      .locator(".friends-list .friend")
      .getByRole("button", { name: "接受", exact: true })
      .click({ timeout: 15000 });
    await expect(
      result.getByRole("button", { name: "已是好友", exact: true }),
    ).toBeDisabled({ timeout: 15000 });
    await input.fill("missing_" + crypto.randomUUID().slice(0, 8));
    await expect(result).toHaveCount(0);
    await a.getByRole("button", { name: "搜索", exact: true }).click();
    await expect(a.getByText("未找到该用户", { exact: true })).toBeVisible();
    // A slow, superseded lookup must not replace a newer result or send an
    // application for a user whose username is no longer in the input.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started!: () => void;
    const requested = new Promise<void>((resolve) => {
      started = resolve;
    });
    let completed!: () => void;
    const oldResponse = new Promise<void>((resolve) => {
      completed = resolve;
    });
    await a.route("**/api/v1/friends/search?**", async (route) => {
      const slow =
        new URL(route.request().url()).searchParams.get("username") ===
        "slow_target";
      if (slow) {
        started();
        await gate;
      }
      await route
        .fulfill({
          json: {
            user: {
              userId: accounts[1]!.user.id,
              username: slow ? "slow_target" : "different_target",
              displayName: "同名好友",
            },
          },
        })
        .catch(() => {});
      if (slow) completed();
    });
    await input.fill("slow_target");
    await a.getByRole("button", { name: "搜索", exact: true }).click();
    await requested;
    await input.fill("different_target");
    await expect(result).toHaveCount(0);
    await a.getByRole("button", { name: "搜索", exact: true }).click();
    await expect(result).toContainText("different_target");
    release();
    await oldResponse;
    await expect(result).not.toContainText("slow_target");
  } finally {
    const closed = await Promise.allSettled(
      contexts.map((context) => context.close()),
    );
    if (accounts.length)
      execFileSync(
        "bun",
        [
          "tests/e2e/helpers/cleanup-social.ts",
          ...accounts.map((a) => a.user.id),
        ],
        { stdio: "pipe" },
      );
    for (const result of closed) expect(result.status).toBe("fulfilled");
  }
});
