import { test, expect } from "@playwright/test";

test("room controls, sound sliders and chat compose fit the minimum and default window without page scrolling", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "访客体验", exact: true }).click();
  await page.getByLabel("你的昵称").fill("紧凑布局回归");
  await page.getByRole("button", { name: "进入映聚", exact: true }).click();
  await page.getByRole("button", { name: "创建私人房间", exact: true }).click();
  await page.getByLabel("房间名称").fill("窗口自适应回归");
  await page.getByRole("button", { name: "创建并进入", exact: true }).click();
  try {
    await expect(
      page.getByRole("button", { name: "选择屏幕开始共享" }),
    ).toBeEnabled();
    for (const viewport of [
      { width: 980, height: 680 },
      { width: 1150, height: 780 },
      { width: 1360, height: 900 },
      { width: 1800, height: 720 },
    ]) {
      await page.setViewportSize(viewport);
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              document.documentElement.scrollHeight <= innerHeight &&
              document.documentElement.scrollWidth <= innerWidth,
          ),
        )
        .toBe(true);
      for (const selector of [
        ".stage",
        ".mixer-card",
        ".controls",
        ".room-panel",
      ]) {
        const box = await page.locator(selector).boundingBox();
        expect(
          box && box.y >= 0 && box.y + box.height <= viewport.height,
        ).toBeTruthy();
        expect(
          await page
            .locator(selector)
            .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
        ).toBe(true);
      }
      await page.getByRole("tab", { name: "聊天", exact: true }).click();
      await expect(page.locator(".chat-compose")).toBeInViewport({ ratio: 1 });
      await expect
        .poll(() =>
          page.locator(".chat-compose").evaluate((composer) => {
            const panel = composer.closest(".room-panel")!;
            return Math.abs(
              panel.getBoundingClientRect().bottom -
                composer.getBoundingClientRect().bottom,
            );
          }),
        )
        .toBeLessThanOrEqual(2);
      await page.getByRole("tab", { name: /成员/ }).click();
    }
    await expect(
      page.getByText("THE SCREEN IS YOURS", { exact: true }),
    ).toHaveCount(0);
    await expect(page.locator(".workspace")).not.toContainText("·");
    await page.screenshot({ path: ".local/ui-compact/room-wide.png" });
    await page.setViewportSize({ width: 980, height: 680 });
    await page.screenshot({ path: ".local/ui-compact/room-min.png" });
    await page.route("**/api/v1/rooms/*/messages", (route) =>
      route.fulfill({
        json: {
          items: Array.from({ length: 40 }, (_, i) => ({
            id: crypto.randomUUID(),
            userId: "00000000-0000-4000-8000-000000000001",
            displayName: "聊天布局回归",
            body: `第 ${i + 1} 条消息：较长的聊天记录应该在消息列表内部滚动，输入框始终贴底。`,
            createdAt: new Date().toISOString(),
          })),
          nextCursor: null,
        },
      }),
    );
    await page.getByRole("tab", { name: "聊天", exact: true }).click();
    await expect(page.locator(".chat-message")).toHaveCount(40);
    await expect
      .poll(() =>
        page.locator(".chat-compose").evaluate((composer) => {
          const panel = composer.closest(".room-panel")!;
          return Math.abs(
            panel.getBoundingClientRect().bottom -
              composer.getBoundingClientRect().bottom,
          );
        }),
      )
      .toBeLessThanOrEqual(2);
    expect(
      await page
        .locator(".chat-messages")
        .evaluate((el) => el.scrollHeight > el.clientHeight),
    ).toBe(true);
    await expect(page.locator(".chat-message").last()).toBeInViewport();
    await page.screenshot({ path: ".local/chat-bottom/many-messages-min.png" });
    await page.getByRole("tab", { name: /成员/ }).click();
    await page.getByRole("button", { name: "影院模式", exact: true }).click();
    await expect(page.locator(".controls")).toBeInViewport({ ratio: 1 });
    await expect(page.locator(".stage")).toBeInViewport({ ratio: 1 });
    await page.getByRole("button", { name: "影院模式", exact: true }).click();
    await page.getByRole("menuitem", { name: /^我的房间/ }).click();
    await expect(
      page.getByRole("button", { name: "创建私人房间", exact: true }),
    ).toBeInViewport({ ratio: 1 });
    await expect(
      page.getByRole("button", { name: "加入房间", exact: true }),
    ).toBeInViewport({ ratio: 1 });
    await expect(
      page.getByRole("button", { name: "进入窗口自适应回归", exact: true }),
    ).toBeInViewport({ ratio: 1 });
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollHeight <= innerHeight,
        ),
      )
      .toBe(true);
    await page.screenshot({ path: ".local/ui-compact/home-min.png" });
    await page
      .getByRole("button", { name: "进入窗口自适应回归", exact: true })
      .click();
  } finally {
    await page.getByRole("button", { name: "离开房间", exact: true }).click();
  }
});

test("failed API verification preserves identity until an explicit second confirmation; successful verification saves", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "访客体验", exact: true }).click();
  await page.getByLabel("你的昵称").fill("地址验证回归");
  await page.getByRole("button", { name: "进入映聚", exact: true }).click();
  const token = await page.evaluate(() =>
    localStorage.getItem("cinegather.session"),
  );
  let valid = false;
  let probes = 0;
  await page.route("http://127.0.0.1:14311/api/v1/health", async (route) => {
    probes++;
    expect(route.request().headers()["authorization"]).toBeUndefined();
    await route.fulfill({
      status: valid ? 200 : 503,
      contentType: "application/json",
      body: JSON.stringify(
        valid
          ? { ok: true, database: "up", media: "up", version: "0.1.0" }
          : { error: "unavailable" },
      ),
    });
  });
  const open = async () => {
    await page
      .getByRole("menuitem", { name: "设置与设备", exact: true })
      .click();
    await page.getByRole("tab", { name: "自托管服务器", exact: true }).click();
    await page.getByLabel("API 地址").fill("http://127.0.0.1:14311");
    await page.getByRole("button", { name: "保存地址", exact: true }).click();
  };
  await open();
  await expect(
    page.getByRole("dialog", { name: "无法验证服务器" }),
  ).toBeVisible();
  expect(probes).toBe(1);
  expect(
    await page.evaluate(() => localStorage.getItem("cinegather.api")),
  ).toBeNull();
  expect(
    await page.evaluate(() => localStorage.getItem("cinegather.session")),
  ).toBe(token);
  await page.getByRole("button", { name: "取消保存", exact: true }).click();
  await page.getByRole("button", { name: "关闭对话框", exact: true }).click();
  await open();
  await Promise.all([
    page.waitForEvent("load"),
    page.getByRole("button", { name: "仍然保存", exact: true }).click(),
  ]);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("cinegather.api")))
    .toBe("http://127.0.0.1:14311");
  expect(
    await page.evaluate(() => localStorage.getItem("cinegather.session")),
  ).toBeNull();
  // Return to the healthy local server without changing any real test profile.
  await page.evaluate(() => localStorage.removeItem("cinegather.api"));
  await page.reload();
  valid = true;
  await Promise.all([page.waitForEvent("load"), open()]);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("cinegather.api")))
    .toBe("http://127.0.0.1:14311");
  expect(probes).toBe(3);
  await expect(
    page.getByRole("dialog", { name: "无法验证服务器" }),
  ).toHaveCount(0);
});

test("invalid health bodies and timeouts require confirmation, and closing settings cancels a pending address change", async ({
  page,
}) => {
  await page.goto("/");
  let complete: (() => void) | undefined;
  let mode = "invalid";
  let requests = 0;
  await page.route("http://127.0.0.1:14311/api/v1/health", async (route) => {
    requests++;
    if (mode !== "invalid")
      await new Promise<void>((resolve) => {
        complete = resolve;
      });
    await route
      .fulfill({
        contentType: "application/json",
        body: JSON.stringify(
          mode === "invalid"
            ? { ok: true }
            : { ok: true, database: "up", media: "up", version: "0.1.0" },
        ),
      })
      .catch(() => {});
  });
  const open = async () => {
    await page
      .getByRole("menuitem", { name: "设置与设备", exact: true })
      .click();
    await page.getByRole("tab", { name: "自托管服务器", exact: true }).click();
    await page.getByLabel("API 地址").fill("http://127.0.0.1:14311");
    await page.getByRole("button", { name: "保存地址", exact: true }).click();
  };
  await open();
  await expect(
    page.getByRole("dialog", { name: "无法验证服务器" }),
  ).toContainText("有效的映聚健康状态");
  await page.getByRole("button", { name: "取消保存", exact: true }).click();
  await page.getByRole("button", { name: "关闭对话框", exact: true }).click();
  mode = "pending";
  await open();
  await expect.poll(() => requests).toBe(2);
  await page.getByRole("button", { name: "关闭对话框", exact: true }).click();
  complete?.();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(
    await page.evaluate(() => localStorage.getItem("cinegather.api")),
  ).toBeNull();
  await open();
  await expect(
    page.getByRole("dialog", { name: "无法验证服务器" }),
  ).toBeVisible({ timeout: 8000 });
  await page.getByRole("button", { name: "取消保存", exact: true }).click();
  complete?.();
  expect(
    await page.evaluate(() => localStorage.getItem("cinegather.api")),
  ).toBeNull();
});
