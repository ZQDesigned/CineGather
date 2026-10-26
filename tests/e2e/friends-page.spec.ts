import { test, expect } from "@playwright/test";
import { registerTestAccount } from "./helpers/account";

test("friends has its own page, tabs and URL without displaying an identity card", async ({
  page,
}) => {
  await page.goto("/");
  await registerTestAccount(page, "好友页面回归");
  await page.getByRole("menuitem", { name: "好友", exact: true }).click();
  await expect(page).toHaveURL(/#\/friends$/);
  await expect(
    page.getByRole("heading", { name: "好友", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("我的用户名", { exact: true })).toHaveCount(0);
  await expect(page.getByText("我的用户 ID", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("menuitem", { name: "好友", exact: true }),
  ).toHaveClass(/ant-menu-item-selected/);
  for (const name of ["全部好友", "在线好友", "好友申请", "添加好友"])
    await expect(
      page.getByRole("tab", { name: new RegExp(name) }),
    ).toBeVisible();
  await page.getByRole("tab", { name: "添加好友", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "好友用户名", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.locator(".friends-page")).toBeVisible();
  await page.getByRole("menuitem", { name: /我的房间/ }).click();
  await expect(page.locator(".home")).toBeVisible();
  await page.goto("/friends");
  await expect(page.locator(".friends-page")).toBeVisible();
  await page.getByRole("link", { name: "映聚首页", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator(".home")).toBeVisible();
  await page.getByRole("menuitem", { name: "好友", exact: true }).click();
  await page.goBack();
  await expect(page.locator(".home")).toBeVisible();
  await page.goForward();
  await expect(page.locator(".friends-page")).toBeVisible();
  const friends = Array.from({ length: 48 }, (_, index) => ({
    userId: crypto.randomUUID(),
    displayName: "好友列表长昵称布局测试".repeat(3),
    status: "accepted",
    incoming: false,
    online: index % 2 === 0,
  }));
  await page.route("**/api/v1/friends", (route) =>
    route.fulfill({ json: { items: friends } }),
  );
  await page.reload();
  await expect(page.locator(".friends-list .friend")).toHaveCount(48);
  await page.setViewportSize({ width: 1000, height: 700 });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.documentElement.scrollHeight <= innerHeight &&
          document.documentElement.scrollWidth <= innerWidth,
      ),
    )
    .toBe(true);
  await expect
    .poll(() =>
      page
        .locator(".friends-tabs > .ant-tabs-body-holder")
        .evaluate((element) => element.scrollHeight > element.clientHeight),
    )
    .toBe(true);
  await page.locator(".friends-list .friend").last().scrollIntoViewIfNeeded();
  await expect(page.locator(".friends-list .friend").last()).toBeInViewport();
  await page.getByRole("tab", { name: /^在线好友/ }).click();
  await expect(page.locator(".friends-list .friend")).toHaveCount(24);
  await expect(page.locator(".friends-list .friend").first()).toBeInViewport({
    ratio: 1,
  });
  await page.screenshot({
    path: ".local/friend-experience/friends-page-narrow.png",
  });
});

test("visiting friends keeps the room connected and exposes return and leave actions", async ({
  page,
}) => {
  await page.goto("/");
  await registerTestAccount(page, "好友页房间连续性");
  await page.getByRole("button", { name: "创建私人房间", exact: true }).click();
  await page.getByLabel("房间名称").fill("好友页不中断房间");
  await page.getByRole("button", { name: "创建并进入", exact: true }).click();
  await expect(page.locator(".room-page")).toBeVisible();
  await page.getByRole("menuitem", { name: "好友", exact: true }).click();
  await expect(page.locator(".friends-page")).toBeVisible();
  await expect(page.locator(".room-page")).toBeHidden();
  await expect(
    page.getByRole("group", { name: "当前加入的房间", exact: true }),
  ).toContainText("好友页不中断房间");
  await expect(page.locator(".connection")).toHaveText("已连接");
  await page.getByRole("button", { name: "返回当前房间", exact: true }).click();
  await expect(page.locator(".room-page")).toBeVisible();
  await expect(page.locator(".friends-page")).toHaveCount(0);
  await page.getByRole("menuitem", { name: "好友", exact: true }).click();
  await page.getByRole("button", { name: "退出当前房间", exact: true }).click();
  await expect(page.locator(".connection")).toHaveText("未连接房间");
  await expect(page.locator(".friends-page")).toBeVisible();
  await expect(
    page.getByRole("group", { name: "当前加入的房间", exact: true }),
  ).toHaveCount(0);
  await page.setViewportSize({ width: 1000, height: 700 });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.documentElement.scrollHeight <= innerHeight &&
          document.documentElement.scrollWidth <= innerWidth,
      ),
    )
    .toBe(true);
});
