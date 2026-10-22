import { test, expect } from "@playwright/test";

test("capture categories are tabs and sources are keyboard-selectable single-choice preview cards", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("你的昵称").fill("组件回归");
  await page.getByRole("button", { name: "进入映聚", exact: true }).click();
  await page.getByRole("button", { name: "创建私人房间", exact: true }).click();
  await page.getByLabel("房间名称").fill("采集组件回归");
  await page.getByRole("button", { name: "创建并进入" }).click();
  await expect(
    page.getByRole("button", { name: "选择屏幕开始共享" }),
  ).toBeEnabled();
  await page.evaluate(() => {
    Object.assign(window, {
      desktop: {
        platform: "darwin",
        sources: async () => [
          { id: "screen:1", name: "显示器 1", kind: "screen", thumbnail: "" },
          { id: "screen:2", name: "显示器 2", kind: "screen", thumbnail: "" },
          { id: "window:1", name: "受控窗口", kind: "window", thumbnail: "" },
        ],
        selectSource: async () => {},
        cancelCapture: async () => {},
        setSharing: async () => {},
      },
    });
  });
  try {
    await page.getByRole("button", { name: "选择屏幕开始共享" }).click();
    await expect(
      page.getByRole("tab", { name: "整个屏幕", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    const first = page.getByRole("radio", { name: "显示器 1", exact: true });
    await expect(first).toBeChecked();
    await first.focus();
    await page.keyboard.press("ArrowRight");
    await expect(
      page.getByRole("radio", { name: "显示器 2", exact: true }),
    ).toBeChecked();
    const preview = await page
      .locator(".source-card")
      .first()
      .locator(".source-preview")
      .boundingBox();
    const caption = await page
      .locator(".source-card")
      .first()
      .locator(".source-name")
      .boundingBox();
    expect(
      preview && caption && preview.y + preview.height <= caption.y + 1,
    ).toBeTruthy();
    await page.getByRole("tab", { name: "应用窗口", exact: true }).click();
    await expect(
      page.getByRole("radio", { name: "受控窗口", exact: true }),
    ).toBeChecked();
    await page.setViewportSize({ width: 980, height: 680 });
    const confirm = await page
      .getByRole("button", { name: "确认共享", exact: true })
      .boundingBox();
    expect(confirm && confirm.y + confirm.height < 680).toBeTruthy();
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "共享屏幕", exact: true }),
    ).toBeVisible();
    await page.getByRole("menuitem", { name: /^我的房间/ }).click();
    await expect(page.getByRole("heading", { name: /晚上好/ })).toBeVisible();
    await expect(page.locator(".connection")).toContainText("已连接");
    await page
      .getByRole("button", { name: "进入采集组件回归", exact: true })
      .click();
    await expect(page.getByRole("tab", { name: /成员/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.getByRole("tab", { name: "聊天", exact: true }).click();
    await expect(
      page.getByRole("tabpanel", { name: "聊天", exact: true }),
    ).toContainText("第一句");
  } finally {
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "离开房间", exact: true }).click();
  }
});

test("settings tabs preserve draft fields and keep the matching submit action visible", async ({
  page,
}) => {
  await page.setViewportSize({ width: 980, height: 680 });
  await page.goto("/");
  await page.getByRole("menuitem", { name: "设置与设备", exact: true }).click();
  await page.getByRole("tab", { name: "共享与快捷键", exact: true }).click();
  await page
    .getByLabel("全局麦克风静音", { exact: true })
    .fill("CommandOrControl+Shift+K");
  await page.getByRole("tab", { name: "音频设备", exact: true }).click();
  await page.getByRole("tab", { name: "共享与快捷键", exact: true }).click();
  await expect(page.getByLabel("全局麦克风静音", { exact: true })).toHaveValue(
    "CommandOrControl+Shift+K",
  );
  const save = await page
    .getByRole("button", { name: "保存设置", exact: true })
    .boundingBox();
  expect(save && save.y + save.height < 680).toBeTruthy();
  await page.getByRole("tab", { name: "自托管服务器", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "保存地址并重新建立身份", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "保存设置", exact: true }),
  ).toHaveCount(0);
});
