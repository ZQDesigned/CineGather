import { test, expect, type BrowserContext } from "@playwright/test";
import { execFileSync } from "node:child_process";
test("friend remarks and pins persist across clients, stay private and carry into room invitations", async ({
  browser,
  request,
}) => {
  test.setTimeout(90000);
  const base = "http://127.0.0.1:14310/api/v1";
  const accounts: { user: { id: string }; sessionToken: string }[] = [],
    contexts: BrowserContext[] = [],
    roomIds: string[] = [];
  const headers = (i: number) => ({
    Authorization: "Bearer " + accounts[i]!.sessionToken,
  });
  try {
    for (const displayName of ["备注设置者", "好友甲", "好友乙"]) {
      const response = await request.post(base + "/accounts/register", {
        data: {
          username:
            "notes_" + crypto.randomUUID().replaceAll("-", "").slice(0, 20),
          displayName,
          password: "Friend note fixture 123!",
        },
      });
      expect(response.status()).toBe(201);
      accounts.push(await response.json());
    }
    for (const i of [1, 2]) {
      expect(
        (
          await request.post(base + "/friends", {
            headers: headers(0),
            data: { userId: accounts[i]!.user.id },
          })
        ).status(),
      ).toBe(201);
      expect(
        (
          await request.post(base + `/friends/${accounts[0]!.user.id}/accept`, {
            headers: headers(i),
          })
        ).status(),
      ).toBe(201);
    }
    for (const i of [0, 0, 1]) {
      const c = await browser.newContext({ permissions: ["microphone"] });
      contexts.push(c);
      await c.addInitScript(
        (token) => localStorage.setItem("cinegather.session", token),
        accounts[i]!.sessionToken,
      );
    }
    const a = await contexts[0]!.newPage(),
      other = await contexts[1]!.newPage(),
      b = await contexts[2]!.newPage();
    for (const page of [a, other, b]) {
      await page.goto("/");
      await page.getByRole("menuitem", { name: "好友", exact: true }).click();
    }
    const row = (page: typeof a, name: string) =>
      page
        .locator(".friends-list .friend")
        .filter({ has: page.locator(".friend-name", { hasText: name }) });
    const menu = async (name: string) => {
      await a
        .getByRole("button", { name: name + "的好友操作", exact: true })
        .click();
    };
    const edit = async (name: string, remark: string) => {
      await menu(name);
      await a.getByRole("menuitem", { name: "设置备注", exact: true }).click();
      await a
        .getByRole("textbox", { name: "好友备注", exact: true })
        .fill(remark);
      await a.getByRole("button", { name: "保存备注", exact: true }).click();
      await expect(a.getByRole("dialog", { name: /^设置备注/ })).toHaveCount(0);
    };
    await edit("好友甲", "一起开黑的搭子");
    await expect(row(a, "一起开黑的搭子")).toContainText("好友甲");
    await expect(row(other, "一起开黑的搭子")).toBeVisible({ timeout: 15000 });
    await expect(b.locator(".friend-name")).toHaveText("备注设置者");
    await menu("好友乙");
    await a.getByRole("menuitem", { name: "置顶好友", exact: true }).click();
    await expect(a.locator(".friends-list .friend-name").first()).toHaveText(
      "好友乙",
    );
    await expect(
      row(a, "好友乙").locator('[aria-label="已置顶"]'),
    ).toBeVisible();
    await menu("一起开黑的搭子");
    await a.getByRole("menuitem", { name: "置顶好友", exact: true }).click();
    await a.getByRole("tab", { name: /^在线好友/ }).click();
    await expect(
      row(a, "一起开黑的搭子").locator('[aria-label="已置顶"]'),
    ).toBeVisible();
    await a.getByRole("tab", { name: /^全部好友/ }).click();
    await menu("一起开黑的搭子");
    await a.getByRole("menuitem", { name: "取消置顶", exact: true }).click();
    await a.reload();
    await a.getByRole("menuitem", { name: "好友", exact: true }).click();
    await expect(a.locator(".friends-list .friend-name").first()).toHaveText(
      "好友乙",
    );
    await expect(row(a, "一起开黑的搭子")).toContainText("好友甲");
    await a.screenshot({ path: ".local/friend-notes-pins/friends.png" });
    const created = await request.post(base + "/rooms", {
      headers: headers(0),
      data: { name: "备注邀请验证", maxMembers: 5, access: "normal" },
    });
    expect(created.status()).toBe(201);
    const room = await created.json();
    roomIds.push(room.id);
    await a.evaluate(async (id) => {
      const actions = await import("/controller.ts" as string);
      await actions.roomSession.enter(id);
    }, room.id);
    await a.getByRole("button", { name: "邀请朋友", exact: true }).click();
    await a.getByRole("tab", { name: "邀请好友", exact: true }).click();
    const picker = a.getByRole("dialog", { name: "邀请朋友", exact: true });
    await expect(picker.locator(".ant-list-item").first()).toContainText(
      "好友乙",
    );
    await expect(
      picker.getByRole("button", {
        name: "邀请一起开黑的搭子加入房间",
        exact: true,
      }),
    ).toBeVisible();
    await a.waitForTimeout(350);
    await a.screenshot({ path: ".local/friend-notes-pins/invite.png" });
    await a.getByRole("button", { name: "关闭对话框", exact: true }).click();
    await a.getByRole("button", { name: "离开房间", exact: true }).click();
    await a.getByRole("menuitem", { name: "好友", exact: true }).click();
    await edit("一起开黑的搭子", "");
    await expect(row(a, "好友甲")).toBeVisible();
    await expect(row(other, "好友甲")).toBeVisible({ timeout: 15000 });
    await menu("好友乙");
    await a.getByRole("menuitem", { name: "取消置顶", exact: true }).click();
    await expect(a.locator('.friends-list [aria-label="已置顶"]')).toHaveCount(
      0,
    );
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
