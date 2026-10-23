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
    .getByRole("button", { name: "页面内麦克风静音", exact: true })
    .click();
  await page.keyboard.press("Control+Shift+K");
  await page.getByRole("tab", { name: "音频设备", exact: true }).click();
  await page.getByRole("tab", { name: "共享与快捷键", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "页面内麦克风静音", exact: true }),
  ).toContainText(
    process.platform === "darwin" ? "⌃ + ⇧ + K" : "Ctrl + Shift + K",
  );
  await page
    .getByRole("button", { name: "页面内麦克风静音", exact: true })
    .click();
  await page.keyboard.press("A");
  await expect(
    page.getByRole("button", { name: "页面内麦克风静音", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "页面内麦克风静音", exact: true }),
  ).toContainText(
    process.platform === "darwin" ? "⌃ + ⇧ + K" : "Ctrl + Shift + K",
  );
  expect(
    await page
      .locator(".ant-modal-body")
      .evaluate((el) => el.scrollHeight <= el.clientHeight),
  ).toBe(true);
  await page.screenshot({ path: ".local/ui-compact/settings-sharing-min.png" });
  const save = await page
    .getByRole("button", { name: "保存设置", exact: true })
    .boundingBox();
  expect(save && save.y + save.height < 680).toBeTruthy();
  await page.getByRole("tab", { name: "自托管服务器", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "保存地址", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "保存设置", exact: true }),
  ).toHaveCount(0);
});

test("native preview loading ignores stale category and closed-picker results and refreshes real image elements", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("你的昵称").fill("预览交互回归");
  await page.getByRole("button", { name: "进入映聚", exact: true }).click();
  await page.getByRole("button", { name: "创建私人房间", exact: true }).click();
  await page.getByLabel("房间名称").fill("预览更新回归");
  await page.getByRole("button", { name: "创建并进入" }).click();
  await expect(
    page.getByRole("button", { name: "选择屏幕开始共享" }),
  ).toBeEnabled();
  await page.evaluate(() => {
    const requests: {
      ids: string[];
      resolve: (frames: { id: string; thumbnail: string }[]) => void;
    }[] = [];
    Object.assign(window, {
      previewRequests: requests,
      desktop: {
        platform: "darwin",
        nativeCapture: true,
        sources: async () => [
          {
            id: "native-screen:1",
            name: "显示器 1",
            kind: "screen",
            thumbnail: "",
          },
          { id: "native:1:2", name: "受控窗口", kind: "window", thumbnail: "" },
        ],
        sourceThumbnails: (ids: string[]) =>
          new Promise((resolve) => requests.push({ ids, resolve })),
        selectSource: async () => {},
        cancelCapture: async () => {},
        setSharing: async () => {},
      },
    });
  });
  const requests = () =>
    page.evaluate(
      () =>
        (window as unknown as { previewRequests: unknown[] }).previewRequests
          .length,
    );
  const complete = (index: number, color: string) =>
    page.evaluate(
      ({ index, color }) => {
        const canvas = document.createElement("canvas");
        canvas.width = 40;
        canvas.height = 24;
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, 40, 24);
        const request = (
          window as unknown as {
            previewRequests: {
              ids: string[];
              resolve: (frames: { id: string; thumbnail: string }[]) => void;
            }[];
          }
        ).previewRequests[index]!;
        request.resolve(
          request.ids.map((id) => ({
            id,
            thumbnail: canvas.toDataURL("image/jpeg"),
          })),
        );
      },
      { index, color },
    );
  try {
    await page.getByRole("button", { name: "选择屏幕开始共享" }).click();
    await expect.poll(requests).toBe(1);
    await expect(page.getByRole("status")).toContainText("正在获取预览");
    await page.getByRole("tab", { name: "整个屏幕", exact: true }).click();
    await expect.poll(requests).toBe(2);
    await complete(0, "blue");
    await expect(page.locator(".source-preview img")).toHaveCount(0);
    await complete(1, "green");
    const image = page.locator(".source-preview img");
    await expect(image).toBeVisible();
    await expect
      .poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth))
      .toBe(40);
    const original = await image.getAttribute("src");
    await page.getByRole("button", { name: "刷新预览", exact: true }).click();
    await expect.poll(requests).toBe(3);
    await complete(2, "red");
    await expect(image).not.toHaveAttribute("src", original!);
    await page.getByRole("button", { name: "刷新预览", exact: true }).click();
    await expect.poll(requests).toBe(4);
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await complete(3, "blue");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("button", { name: "选择屏幕开始共享" }).click();
    await expect.poll(requests).toBe(5);
    await expect(image).toHaveCount(0);
    await complete(4, "orange");
    await expect(image).toBeVisible();
    await page.getByRole("button", { name: "取消", exact: true }).click();
  } finally {
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "离开房间", exact: true }).click();
  }
});

test("native screen audio is a system mix and window audio remains app-scoped", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("你的昵称").fill("系统声音组件回归");
  await page.getByRole("button", { name: "进入映聚", exact: true }).click();
  await page.getByRole("button", { name: "创建私人房间", exact: true }).click();
  await page.getByLabel("房间名称").fill("系统声音组件回归");
  await page.getByRole("button", { name: "创建并进入", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "选择屏幕开始共享" }),
  ).toBeEnabled();
  await page.evaluate(() =>
    Object.assign(window, {
      desktop: {
        platform: "darwin",
        nativeCapture: true,
        sources: async () => [
          {
            id: "native-screen:1",
            kind: "screen",
            name: "显示器 1",
            thumbnail: "",
          },
          {
            id: "native:12:34",
            kind: "window",
            name: "受控窗口",
            thumbnail: "",
          },
        ],
        sourceThumbnails: async () => [],
        cancelCapture: async () => {},
        setSharing: async () => {},
      },
    }),
  );
  try {
    await page.getByRole("button", { name: "选择屏幕开始共享" }).click();
    await expect(
      page.getByRole("checkbox", { name: "共享此应用的声音", exact: true }),
    ).toBeVisible();
    await page.getByRole("tab", { name: "整个屏幕", exact: true }).click();
    await page
      .getByRole("checkbox", { name: "共享系统声音（排除映聚）", exact: true })
      .check();
    await expect(
      page.getByRole("button", { name: "确认共享", exact: true }),
    ).toBeEnabled();
    await expect(
      page.getByRole("combobox", { name: "声音来源应用" }),
    ).toHaveCount(0);
    await expect(page.getByRole("dialog")).not.toContainText(
      "与麦克风独立传输",
    );
    await page.getByRole("tab", { name: "应用窗口", exact: true }).click();
    await expect(
      page.getByRole("checkbox", { name: "共享此应用的声音", exact: true }),
    ).toBeChecked();
  } finally {
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await page.getByRole("button", { name: "离开房间", exact: true }).click();
  }
});
