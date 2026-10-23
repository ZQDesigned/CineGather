import { test, expect, type Page } from "@playwright/test";

async function watchClosing(page: Page) {
  await page.evaluate(() => {
    const target = window as unknown as { closingMotion?: { names: string[] } };
    if (target.closingMotion) {
      target.closingMotion.names = [];
      return;
    }
    const probe = { names: [] as string[] };
    target.closingMotion = probe;
    document.addEventListener("animationstart", (event) => {
      if (
        !(event.target instanceof Element) ||
        !event.target.matches(".cinema-dialog, .ant-modal-mask")
      )
        return;
      if (!/Out/i.test(event.animationName)) return;
      probe.names.push(event.animationName);
      for (const animation of event.target.getAnimations()) animation.pause();
    });
  });
}
async function finishClosing(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { closingMotion: { names: string[] } })
            .closingMotion.names.length,
      ),
    )
    .toBeGreaterThanOrEqual(2);
  await expect(page.locator(".cinema-dialog")).toHaveCount(1);
  await expect(page.locator(".ant-modal-mask")).toHaveCount(1);
  await page.evaluate(() =>
    document.getAnimations().forEach((animation) => animation.finish()),
  );
  await expect(page.locator(".cinema-dialog")).toHaveCount(0);
  await expect(page.locator(".ant-modal-mask")).toHaveCount(0);
}

test("settings keeps its panel and mask mounted until their exit animations complete", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const trigger = page.getByRole("menuitem", {
    name: "设置与设备",
    exact: true,
  });
  await trigger.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await watchClosing(page);
  await page.getByRole("button", { name: "关闭对话框", exact: true }).click();
  await finishClosing(page);
  await expect(trigger).toBeFocused();
});

test("create, join, friends and diagnostics animate every supported close action", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("你的昵称").fill("对话框动画回归");
  await page.getByRole("button", { name: "进入映聚", exact: true }).click();
  const cases = [
    {
      role: "button" as const,
      trigger: "创建私人房间",
      title: "创建私人房间",
      close: "cancel",
    },
    {
      role: "button" as const,
      trigger: "加入房间",
      title: "加入朋友的房间",
      close: "escape",
    },
    {
      role: "menuitem" as const,
      trigger: "好友",
      title: "朋友们",
      close: "mask",
    },
    {
      role: "menuitem" as const,
      trigger: "连接诊断",
      title: "连接诊断",
      close: "icon",
    },
  ];
  for (const entry of cases) {
    await page
      .getByRole(entry.role, { name: entry.trigger, exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: entry.title, exact: true }),
    ).toBeVisible();
    if (entry.close === "cancel")
      await expect(page.locator(".dialog-header p")).toHaveCount(0);
    await watchClosing(page);
    if (entry.close === "cancel")
      await page.getByRole("button", { name: "取消", exact: true }).click();
    else if (entry.close === "escape") await page.keyboard.press("Escape");
    else if (entry.close === "mask")
      await page
        .locator(".ant-modal-wrap")
        .click({ position: { x: 10, y: 10 } });
    else
      await page
        .getByRole("button", { name: "关闭对话框", exact: true })
        .click();
    await finishClosing(page);
  }
});

test("invites, bans and source selection animate closing without retaining the screen lease", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("你的昵称").fill("房间弹窗动画回归");
  await page.getByRole("button", { name: "进入映聚", exact: true }).click();
  await page.getByRole("button", { name: "创建私人房间", exact: true }).click();
  await page.getByRole("button", { name: "创建并进入", exact: true }).click();
  await expect(page.locator(".cinema-dialog")).toHaveCount(0);
  try {
    for (const trigger of ["邀请朋友", "管理房间黑名单"]) {
      await page.getByRole("button", { name: trigger, exact: true }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await watchClosing(page);
      await page.keyboard.press("Escape");
      await finishClosing(page);
    }
    await page.evaluate(() =>
      Object.assign(window, {
        desktop: {
          platform: "darwin",
          nativeCapture: true,
          sources: async () => [
            {
              id: "native:1:2",
              name: "受控窗口",
              kind: "window",
              thumbnail: "",
            },
          ],
          sourceThumbnails: async () => [],
          cancelCapture: async () => {},
          setSharing: async () => {},
        },
      }),
    );
    await page
      .getByRole("button", { name: "选择屏幕开始共享", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await watchClosing(page);
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "选择屏幕开始共享", exact: true }),
    ).toBeEnabled();
    await finishClosing(page);
  } finally {
    await page.getByRole("button", { name: "离开房间", exact: true }).click();
  }
});

test("microphone testing stops as closing begins while the exit animation is still paused", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    const tracks: MediaStreamTrack[] = [];
    Object.assign(window, { motionTestTracks: tracks });
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await original(constraints);
      tracks.push(...stream.getTracks());
      return stream;
    };
  });
  await page.goto("/");
  await page.getByRole("menuitem", { name: "设置与设备", exact: true }).click();
  await page.getByRole("button", { name: "测试麦克风", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "停止测试", exact: true }),
  ).toBeVisible();
  await watchClosing(page);
  await page.getByRole("button", { name: "关闭对话框", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const tracks = (
          window as unknown as { motionTestTracks: MediaStreamTrack[] }
        ).motionTestTracks;
        return (
          tracks.length > 0 &&
          tracks.every((track) => track.readyState === "ended")
        );
      }),
    )
    .toBe(true);
  await finishClosing(page);
});

test("reduced motion still completes dialog cleanup and resets abandoned drafts", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.getByLabel("你的昵称").fill("减少动画回归");
  await page.getByRole("button", { name: "进入映聚", exact: true }).click();
  const trigger = page.getByRole("button", {
    name: "创建私人房间",
    exact: true,
  });
  await trigger.click();
  await page.getByLabel("房间名称").fill("不要保留的草稿");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.locator(".cinema-dialog")).toHaveCount(0);
  await trigger.click();
  await expect(page.getByLabel("房间名称")).toHaveValue("今晚一起看");
  await page.keyboard.press("Escape");
  await expect(page.locator(".cinema-dialog")).toHaveCount(0);
});

test("an incoming invitation waits for the previous dialog to finish closing before receiving focus", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.assign(window, {
      desktop: {
        loadSettings: async () => {
          throw new Error("Use browser defaults");
        },
        takeInvitation: async () => undefined,
        onAction: (callback: (action: string, value: string) => void) => {
          Object.assign(window, { emitDesktopAction: callback });
          return () => {};
        },
      },
    }),
  );
  await page.goto("/");
  await page.getByLabel("你的昵称").fill("弹窗切换回归");
  await page.getByRole("button", { name: "进入映聚", exact: true }).click();
  await page.getByRole("menuitem", { name: "设置与设备", exact: true }).click();
  await watchClosing(page);
  const invitation = `cinegather://join?room=1234ABCD&invite=${"x".repeat(43)}`;
  await page.evaluate(
    (value) =>
      (
        window as unknown as {
          emitDesktopAction(action: string, value: string): void;
        }
      ).emitDesktopAction("invite", value),
    invitation,
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { closingMotion: { names: string[] } })
            .closingMotion.names.length,
      ),
    )
    .toBeGreaterThanOrEqual(2);
  await expect(
    page.getByRole("heading", { name: "加入朋友的房间", exact: true }),
  ).toHaveCount(0);
  await page.evaluate(() =>
    document.getAnimations().forEach((animation) => animation.finish()),
  );
  await expect(
    page.getByRole("heading", { name: "加入朋友的房间", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".cinema-dialog")).toHaveCount(1);
  await expect(page.getByLabel("房间号或邀请链接")).toHaveValue(invitation);
  await expect(page.getByLabel("房间号或邀请链接")).toBeFocused();
  await watchClosing(page);
  await page.keyboard.press("Escape");
  await finishClosing(page);
});

test("losing the room and identity while bans closes does not crash its exiting content", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByLabel("你的昵称").fill("房间退出动画回归");
  await page.getByRole("button", { name: "进入映聚", exact: true }).click();
  await page.getByRole("button", { name: "创建私人房间", exact: true }).click();
  await page.getByRole("button", { name: "创建并进入", exact: true }).click();
  await expect(page.locator(".cinema-dialog")).toHaveCount(0);
  await page
    .getByRole("button", { name: "管理房间黑名单", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "房间黑名单", exact: true }),
  ).toBeVisible();
  await watchClosing(page);
  const token = await page.evaluate(() =>
    localStorage.getItem("cinegather.session"),
  );
  const revoked = await request.delete(
    "http://127.0.0.1:14310/api/v1/session",
    { headers: { Authorization: `Bearer ${token}` } },
  );
  expect(revoked.status()).toBe(200);
  await expect(page.getByLabel("你的昵称")).toBeVisible();
  await finishClosing(page);
  expect(errors).toEqual([]);
});
