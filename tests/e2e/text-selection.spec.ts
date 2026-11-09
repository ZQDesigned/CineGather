import { test, expect, type Locator, type Page } from "@playwright/test";
import { registerTestAccount } from "./helpers/account";

async function dragText(page: Page, locator: Locator) {
  await locator.scrollIntoViewIfNeeded();
  await locator.hover({ trial: true, timeout: 5000 });
  const rect = await locator.evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let text: Node | null;
    while ((text = walker.nextNode())) {
      if (!text.textContent?.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(text);
      const r = range.getClientRects()[0];
      if (r?.width) return { x: r.x, y: r.y, width: r.width, height: r.height };
    }
    throw Error("No visible text to drag");
  });
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await page.mouse.move(rect.x + 1, rect.y + rect.height / 2);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width - 1, rect.y + rect.height / 2, {
    steps: 20,
  });
  await page.mouse.up();
  return page.evaluate(() => window.getSelection()?.toString() ?? "");
}
async function desktop(page: Page, platform: "win32" | "darwin") {
  await page.addInitScript((platform) => {
    Object.assign(window, {
      desktop: {
        platform,
        loadSettings: async () => {
          throw Error("Use local defaults");
        },
        takeInvitation: async () => undefined,
        onAction: () => () => {},
        cancelCapture: async () => {},
        setSharing: async () => {},
      },
    });
  }, platform);
}
for (const platform of ["win32", "darwin"] as const) {
  test(`${platform} defaults to unselectable chrome but retains editable inputs and portal controls`, async ({
    page,
  }) => {
    await desktop(page, platform);
    await page.goto("/");
    expect(await dragText(page, page.locator(".welcome-art h1"))).toBe("");
    const username = page.getByLabel("用户名", { exact: true });
    await username.fill("selection_test");
    await username.press("ControlOrMeta+a");
    expect(
      await username.evaluate((e: HTMLInputElement) =>
        e.value.slice(e.selectionStart!, e.selectionEnd!),
      ),
    ).toBe("selection_test");
    await page.getByRole("button", { name: "账户菜单", exact: true }).click();
    const item = page.getByRole("menuitem", { name: "连接诊断", exact: true });
    expect(await item.evaluate((e) => getComputedStyle(e).userSelect)).toBe(
      "none",
    );
    await item.click();
    expect(
      await dragText(
        page,
        page.getByRole("heading", { name: "连接诊断", exact: true }),
      ),
    ).toBe("");
    await page.getByRole("button", { name: "关闭对话框", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "账户菜单", exact: true }),
    ).toBeFocused();
  });
}

test("web text selection and input editing remain unchanged", async ({
  page,
}) => {
  await page.goto("/");
  expect(await dragText(page, page.locator(".welcome-art h1"))).toContain(
    "相隔千里",
  );
  expect(
    await page.locator("body").evaluate((e) => getComputedStyle(e).userSelect),
  ).not.toBe("none");
  const username = page.getByLabel("用户名", { exact: true });
  await username.fill("web_selection");
  await username.press("ControlOrMeta+a");
  expect(
    await username.evaluate((e: HTMLInputElement) =>
      e.value.slice(e.selectionStart!, e.selectionEnd!),
    ),
  ).toBe("web_selection");
});

test("desktop chat, announcement and error bodies can be dragged and copy actions still work", async ({
  page,
}) => {
  await desktop(page, "win32");
  const now = new Date().toISOString();
  const announcement = {
    id: crypto.randomUUID(),
    title: "文本选择测试公告",
    body: "这是一条可以选中复制的公告正文。",
    kind: "notice",
    popup: false,
    startsAt: null,
    expiresAt: null,
    publishedAt: now,
    createdAt: now,
    updatedAt: now,
    state: "active",
    received: true,
    read: true,
  };
  await page.route("**/api/v1/announcements", (r) =>
    r.fulfill({
      json: { serverTime: new Date().toISOString(), items: [announcement] },
    }),
  );
  await page.route("**/api/v1/announcements/inbox", (r) =>
    r.fulfill({
      json: { serverTime: new Date().toISOString(), items: [announcement] },
    }),
  );
  await page.route("**/api/v1/announcements/read", (r) =>
    r.fulfill({ json: { ok: true } }),
  );
  await page.addInitScript(() => {
    Object.assign(window, { copiedSelection: "", rejectSelectionCopy: false });
    navigator.clipboard.writeText = async (text) => {
      if (
        (window as unknown as { rejectSelectionCopy: boolean })
          .rejectSelectionCopy
      )
        throw Error("Clipboard test failure");
      (window as unknown as { copiedSelection: string }).copiedSelection = text;
    };
  });
  await page.goto("/");
  await registerTestAccount(page, "文本选择体验");
  await page.getByRole("button", { name: "创建私人房间", exact: true }).click();
  await page.getByLabel("房间名称").fill("文本选择回归");
  await page.getByRole("button", { name: "创建并进入", exact: true }).click();
  await expect(page.locator(".connection")).toContainText("已连接");
  try {
    await page.getByRole("tab", { name: /聊天/ }).click();
    await page
      .getByRole("textbox", { name: "聊天消息", exact: true })
      .fill("这是一条可以选中复制的聊天消息。");
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    const chat = page.locator(".chat-message p").last();
    await expect(chat).toContainText("可以选中复制");
    expect(await dragText(page, chat)).toContain("可以选中复制");
    expect(
      await dragText(page, page.locator(".chat-message header strong").last()),
    ).toBe("");
    await page.getByRole("button", { name: "邀请朋友", exact: true }).click();
    const invite = page.getByLabel("房间邀请", { exact: true });
    const value = await invite.inputValue();
    await invite.focus();
    await invite.press("ControlOrMeta+a");
    expect(
      await invite.evaluate((e: HTMLInputElement) =>
        e.value.slice(e.selectionStart!, e.selectionEnd!),
      ),
    ).toBe(value);
    await page
      .getByRole("button", { name: "复制邀请信息", exact: true })
      .click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { copiedSelection: string }).copiedSelection,
        ),
      )
      .toBe(value);
    await page.evaluate(() => {
      (
        window as unknown as { rejectSelectionCopy: boolean }
      ).rejectSelectionCopy = true;
    });
    await page
      .getByRole("button", { name: "复制邀请信息", exact: true })
      .click();
    const error = page
      .locator(".ant-notification-notice-description")
      .filter({ hasText: "无法写入剪贴板" });
    await expect(error).toBeVisible();
    expect(await dragText(page, error)).toContain("无法写入剪贴板");
    await page.getByRole("button", { name: "关闭对话框", exact: true }).click();
    await page.getByRole("button", { name: /^通知/ }).click();
    await page.getByRole("button", { name: "全站公告", exact: true }).click();
    await page
      .getByRole("dialog", { name: "全站公告", exact: true })
      .getByRole("button", { name: "查看", exact: true })
      .click();
    const body = page.getByLabel("公告正文", { exact: true });
    expect(
      await dragText(page, body.getByText(announcement.body, { exact: true })),
    ).toContain("可以选中复制的公告正文");
    expect(
      await dragText(
        page,
        page.getByRole("heading", { name: announcement.title, exact: true }),
      ),
    ).toBe("");
    await page.getByRole("button", { name: "知道了", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("tab", { name: /成员/ }).click();
    await page.evaluate(async () => {
      const { state, update } = await import("/store.ts" as string);
      const current = state();
      update({
        chat: { ...current.chat, unread: 1 },
        chatNotification: {
          roomId: current.room.id,
          message: current.chat.items.at(-1),
        },
      });
    });
    const toast = page.locator(".chat-notification");
    await expect(toast).toBeVisible();
    expect(await dragText(page, toast.locator("p"))).toContain(
      "可以选中复制的聊天消息",
    );
    await expect(toast).toBeVisible();
    await expect(page.getByRole("tab", { name: /成员/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await toast.getByRole("button", { name: "查看消息", exact: true }).click();
    await expect(
      page.getByRole("textbox", { name: "聊天消息", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".connection")).toContainText("已连接");
  } finally {
    if (
      await page
        .getByRole("button", { name: "关闭对话框", exact: true })
        .isVisible()
    )
      await page
        .getByRole("button", { name: "关闭对话框", exact: true })
        .click();
    await page.getByRole("button", { name: "离开房间", exact: true }).click();
  }
});

test("desktop notification windows retain selectable message bodies without selecting their controls", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.assign(window, {
      notificationCard: {
        state: async () => ({
          id: "selection-notification",
          scope: "local-selection",
          title: "聊天通知",
          body: "这是一条可复制的通知消息。",
        }),
        onChange: () => () => {},
        close: async () => {},
        activate: async () => {},
      },
    });
  });
  await page.goto("/");
  expect(
    await dragText(page, page.getByText("聊天通知", { exact: true })),
  ).toBe("");
  expect(
    await dragText(
      page,
      page.getByText("这是一条可复制的通知消息。", { exact: true }),
    ),
  ).toContain("可复制的通知消息");
});
