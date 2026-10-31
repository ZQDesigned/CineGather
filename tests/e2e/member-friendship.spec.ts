import { test, expect } from "@playwright/test";

test("member friendship menus reflect accepted, sent and incoming requests without duplicate submissions", async ({
  page,
}) => {
  page.on("pageerror", (error) =>
    console.error("Member menu page error:", error.stack ?? error.message),
  );
  const self = "00000000-0000-4000-8000-000000000001",
    target = "00000000-0000-4000-8000-000000000002";
  let friends: {
    userId: string;
    displayName: string;
    status: "pending" | "accepted";
    incoming: boolean;
  }[] = [];
  const calls: { path: string; body: unknown }[] = [];
  let fail = false;
  let hold: Promise<void> | undefined;
  const room = {
    id: "00000000-0000-4000-8000-000000000099",
    code: "11223344",
    name: "好友状态检查",
    ownerUserId: self,
    maxMembers: 5,
    role: "owner",
    access: "normal",
  };
  const user = {
    id: self,
    username: "friend_menu_qa",
    displayName: "菜单检查",
    screenShareEnabled: true,
  };
  await page.addInitScript(() =>
    localStorage.setItem("cinegather.session", "local-friendship-fixture"),
  );
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname;
    let json: unknown = { ok: true },
      status = 200;
    if (
      request.method() === "POST" &&
      (path === "/api/v1/friends" || path.endsWith("/accept"))
    ) {
      calls.push({ path, body: request.postDataJSON() });
      await hold;
      if (fail) {
        fail = false;
        status = 503;
        json = {
          code: "TEST_NETWORK",
          message: "网络暂时不可用，请重试",
          requestId: "local-fixture",
        };
      } else {
        friends = [
          {
            userId: target,
            displayName: "房间成员",
            status: path.endsWith("/accept") ? "accepted" : "pending",
            incoming: path.endsWith("/accept"),
          },
        ];
      }
    } else if (path === "/api/v1/me") json = user;
    else if (path === "/api/v1/friends")
      json = { items: friends, roomInvitations: [], roomJoinRequests: [] };
    else if (path === "/api/v1/rooms" || path.endsWith("/share-requests"))
      json = { items: [] };
    else if (path === `/api/v1/rooms/${room.id}`) json = room;
    else if (path.endsWith("/announcements"))
      json = { serverTime: new Date().toISOString(), items: [] };
    else if (path.endsWith("/presence")) json = { visibility: "online" };
    else if (path.endsWith("/registration")) json = { enabled: false };
    else if (path.endsWith("/client-policy"))
      json = {
        minimumVersions: { win32: "0.0.0", darwin: "0.0.0", web: "0.0.0" },
        reason: "",
      };
    await route.fulfill({
      status,
      json,
      headers: { "access-control-allow-origin": "*" },
    });
  });
  await page.goto("/");
  await expect(
    page.getByText("菜单检查", { exact: true }).first(),
  ).toBeVisible();
  await page.evaluate(
    async ({ room, user, target }) => {
      const { useApp } = await import("/store.ts" as string);
      useApp.setState({
        user,
        room,
        roomState: "connected",
        media: {
          ...useApp.getState().media,
          state: "connected",
          participants: [
            {
              id: target,
              name: "房间成员",
              local: false,
              microphone: false,
              speaking: false,
              quality: "excellent",
            },
          ],
        },
      });
    },
    { room, user, target },
  );
  const open = () =>
    page
      .getByRole("button", { name: "房间成员的成员操作", exact: true })
      .click();
  const popup = page.locator(".member-context-popup");
  const setFriends = async (items: typeof friends) => {
    friends = items;
    await page.evaluate(async (items) => {
      const { update } = await import("/store.ts" as string);
      update({ friends: items });
    }, items);
  };
  await setFriends([
    {
      userId: target,
      displayName: "房间成员",
      status: "accepted",
      incoming: false,
    },
  ]);
  await open();
  await expect(
    popup.getByRole("menuitem", { name: "添加好友", exact: true }),
  ).toHaveCount(0);
  await expect(
    popup.getByRole("menuitem", { name: "转移房主", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await setFriends([
    {
      userId: target,
      displayName: "房间成员",
      status: "pending",
      incoming: false,
    },
  ]);
  await open();
  await expect(
    popup.getByRole("menuitem", { name: "好友申请已发送", exact: true }),
  ).toHaveAttribute("aria-disabled", "true");
  await expect(
    popup.getByRole("menuitem", { name: "添加好友", exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await setFriends([
    {
      userId: target,
      displayName: "房间成员",
      status: "pending",
      incoming: true,
    },
  ]);
  await open();
  await popup
    .getByRole("menuitem", { name: "同意好友申请", exact: true })
    .click();
  await expect
    .poll(() => calls.at(-1)?.path)
    .toBe(`/api/v1/friends/${target}/accept`);
  await open();
  await expect(popup.getByRole("menuitem", { name: /好友/ })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await setFriends([]);
  fail = true;
  await open();
  await popup.getByRole("menuitem", { name: "添加好友", exact: true }).click();
  await expect(
    page.getByText("网络暂时不可用，请重试", { exact: true }).first(),
  ).toBeVisible();
  let release!: () => void;
  hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  await open();
  await popup.getByRole("menuitem", { name: "添加好友", exact: true }).click();
  await expect
    .poll(() => calls.filter((c) => c.path === "/api/v1/friends").length)
    .toBe(2);
  await open();
  await expect(
    popup.getByRole("menuitem", { name: "添加好友", exact: true }),
  ).toHaveAttribute("aria-disabled", "true");
  release();
  hold = undefined;
  expect(calls.at(-1)?.body).toEqual({ userId: target });
  await expect(
    popup.getByRole("menuitem", { name: "好友申请已发送", exact: true }),
  ).toHaveAttribute("aria-disabled", "true");
  expect(calls).toHaveLength(3);
  await setFriends([
    {
      userId: target,
      displayName: "房间成员",
      status: "accepted",
      incoming: false,
    },
  ]);
  await expect(popup.getByRole("menuitem", { name: /好友/ })).toHaveCount(0);
  await expect(
    popup.getByRole("menuitem", { name: "转移房主", exact: true }),
  ).toBeVisible();
});
