import { expect, test, type Page } from "@playwright/test";

async function guest(page: Page, name: string) {
  await page.goto("/");
  await page.getByLabel("你的昵称").fill(name);
  await page.getByRole("button", { name: "进入映聚", exact: true }).click();
  await expect(page.locator(".home")).toBeVisible();
}

test("lobby removes the five marked captions while keeping the cinema illustration", async ({
  page,
}) => {
  await guest(page, "大厅文案回归");
  await expect(page.locator(".brand small")).toHaveCount(0);
  await expect(
    page.getByText("A LITTLE CLOSER, EVERY NIGHT", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("为朋友留一排好座位", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("THE BEST SEAT IS NEXT TO YOU.", { exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".privacy-note")).toHaveCount(0);
  await expect(page.locator(".hero-screen")).toContainText("CINEGATHER");
});

test("an active room stays connected in the lobby, can be resumed without rejoining, and can be left from the header", async ({
  page,
  browser,
}) => {
  const other = await browser.newContext({ permissions: ["microphone"] });
  const friend = await other.newPage();
  let finishLeave: (() => void) | undefined;
  let joins = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      /\/rooms\/[^/]+\/join$/.test(new URL(request.url()).pathname)
    )
      joins++;
  });
  const name = "返回大厅仍然保持连接的超长房间名称测试";
  try {
    await guest(page, "大厅房主");
    await page
      .getByRole("button", { name: "创建私人房间", exact: true })
      .click();
    await page.getByLabel("房间名称").fill(name);
    await page.getByRole("button", { name: "创建并进入", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "选择屏幕开始共享", exact: true }),
    ).toBeEnabled();
    const code = (
      await page
        .getByRole("button", { name: "复制房间号", exact: true })
        .innerText()
    ).trim();
    await guest(friend, "大厅观众");
    await friend.getByRole("button", { name: "加入房间", exact: true }).click();
    await friend.getByLabel("房间号或邀请链接").fill(code);
    await friend.getByRole("button", { name: "进入房间", exact: true }).click();
    await expect(friend.locator(".members-list .member")).toHaveCount(2);
    const summary = page.getByRole("group", {
      name: "当前加入的房间",
      exact: true,
    });
    await expect(summary).toHaveCount(0);
    await page.getByRole("menuitem", { name: /^我的房间/ }).click();
    await expect(page.locator(".home")).toBeVisible();
    await expect(summary).toContainText(name);
    await expect(page.locator(".connection")).toContainText("已连接");
    await expect(friend.locator(".members-list .member")).toHaveCount(2);
    const initialJoins = joins;
    await page
      .getByRole("button", { name: "返回当前房间", exact: true })
      .click();
    await expect(page.locator(".room-heading h1")).toBeVisible();
    await expect(summary).toHaveCount(0);
    expect(joins).toBe(initialJoins);
    await page.getByRole("link", { name: "映聚首页", exact: true }).click();
    for (const viewport of [
      { width: 980, height: 680 },
      { width: 1440, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      await expect(summary).toBeInViewport({ ratio: 1 });
      await expect(
        page.getByRole("button", { name: "退出当前房间", exact: true }),
      ).toBeInViewport({ ratio: 1 });
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth <= innerWidth &&
            document.documentElement.scrollHeight <= innerHeight,
        ),
      ).toBe(true);
      expect(
        await page
          .locator(".topbar")
          .evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true);
    }
    await page.screenshot({ path: ".local/lobby-room/active-room.png" });
    await page.route("**/api/v1/rooms/*/leave", async (route) => {
      await new Promise<void>((resolve) => {
        finishLeave = resolve;
      });
      await route.continue();
    });
    const exit = page.getByRole("button", {
      name: "退出当前房间",
      exact: true,
    });
    await exit.click();
    await expect(exit).toBeDisabled();
    await expect.poll(() => Boolean(finishLeave)).toBe(true);
    finishLeave!();
    await expect(summary).toHaveCount(0);
    await expect(page.locator(".home")).toBeVisible();
    await expect(page.locator(".connection")).toContainText("未连接房间");
    await expect(friend.locator(".members-list .member")).toHaveCount(1);
    await expect(page.locator("audio[data-cinegather-audio]")).toHaveCount(0);
    await expect(page.locator(".room-slot")).toHaveCount(0);
  } finally {
    finishLeave?.();
    await other.close();
  }
});
