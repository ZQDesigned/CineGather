import {
  test,
  expect,
  _electron as electron,
  type Page,
} from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { registerTestAccount } from "./helpers/account";
async function send(page: Page, body: string) {
  await page.getByLabel("聊天消息", { exact: true }).fill(body);
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(page.getByLabel("聊天消息", { exact: true })).toHaveValue("");
}
test("room chat pushes while hidden, tracks unread, opens from lobby and preserves history scroll", async ({
  browser,
}) => {
  test.setTimeout(120000);
  const a = await browser.newContext(),
    b = await browser.newContext();
  const sender = await a.newPage(),
    viewer = await b.newPage();
  try {
    await sender.goto("/");
    await registerTestAccount(sender, "聊天实时发布测试");
    await sender
      .getByRole("button", { name: "创建私人房间", exact: true })
      .click();
    await sender.getByLabel("房间名称").fill("聊天实时本机验证");
    await sender
      .getByRole("button", { name: "创建并进入", exact: true })
      .click();
    await expect(sender.locator(".connection")).toContainText("已连接");
    const code = (
      await sender
        .getByRole("button", { name: "复制房间号", exact: true })
        .innerText()
    ).trim();
    await viewer.goto("/");
    await registerTestAccount(viewer, "聊天实时接收测试");
    await viewer.getByRole("button", { name: "加入房间", exact: true }).click();
    await viewer.getByLabel("房间号或邀请链接").fill(code);
    await viewer.getByRole("button", { name: "进入房间", exact: true }).click();
    await expect(viewer.locator(".connection")).toContainText("已连接");
    await expect
      .poll(() =>
        viewer.evaluate(async () => {
          const { useApp } = await import("/store.ts" as string);
          return useApp.getState().chat.loading;
        }),
      )
      .toBe(false);
    let pulls = 0;
    viewer.on("request", (r) => {
      if (r.method() === "GET" && r.url().includes("/messages")) pulls++;
    });
    await sender.getByRole("tab", { name: /聊天/ }).click();
    await send(sender, "即时推送验证");
    await expect(viewer.locator(".ant-notification")).toContainText(
      "即时推送验证",
      { timeout: 2000 },
    );
    await expect(viewer.locator(".chat-tab-label .ant-badge")).toHaveText("1");
    expect(pulls).toBe(0);
    await viewer.bringToFront();
    await viewer.getByRole("button", { name: "查看消息", exact: true }).click();
    await expect(viewer.locator(".chat-message")).toContainText("即时推送验证");
    await expect(viewer.locator(".chat-tab-label .ant-badge")).toBeEmpty();
    await viewer.getByRole("menuitem", { name: /我的房间/ }).click();
    await send(sender, "大厅未读验证");
    await expect(viewer.locator(".current-room .ant-badge")).toHaveText("1");
    await viewer.bringToFront();
    await viewer.getByRole("button", { name: "查看消息", exact: true }).click();
    await expect(viewer.getByLabel("聊天消息", { exact: true })).toBeVisible();
    await expect(viewer.locator(".chat-message").last()).toContainText(
      "大厅未读验证",
    );
    // Fill enough real persisted messages to scroll without clicking through 30 sends.
    await sender.evaluate(async () => {
      const { sendChatMessage } = await import("/controller.ts" as string);
      for (let i = 0; i < 14; i++)
        await sendChatMessage(
          `历史消息 ${i} ` + "用于检验阅读位置。".repeat(30),
        );
    });
    await expect(viewer.locator(".chat-message")).toHaveCount(16);
    await viewer.bringToFront();
    await viewer.locator(".chat-messages").evaluate((e) => {
      e.scrollTop = 0;
      e.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    await send(sender, "请保留历史阅读位置");
    await expect(
      viewer.getByRole("button", { name: "查看 1 条新消息", exact: true }),
    ).toBeVisible();
    expect(
      await viewer.locator(".chat-messages").evaluate((e) => e.scrollTop),
    ).toBe(0);
    await viewer.bringToFront();
    await viewer
      .getByRole("button", { name: "查看 1 条新消息", exact: true })
      .click();
    await expect(
      viewer.getByRole("button", { name: /查看 \d+ 条新消息/ }),
    ).toHaveCount(0);
    expect(
      await viewer
        .locator(".chat-messages")
        .evaluate((e) => e.scrollHeight - e.scrollTop - e.clientHeight),
    ).toBeLessThan(4);
    // Deliberately drop one live packet, then exercise HTTP catch-up and deduplication.
    await viewer.getByRole("tab", { name: /成员/ }).click();
    await viewer.evaluate(async () => {
      const { chat } = await import("/controller.ts" as string);
      const w = window as unknown as { restoreChat?: () => void };
      const receive = chat.receive.bind(chat);
      chat.receive = () => {};
      w.restoreChat = () => {
        chat.receive = receive;
      };
    });
    await send(sender, "恢复后补齐验证");
    await viewer.evaluate(async () => {
      (window as unknown as { restoreChat: () => void }).restoreChat();
      const { chat } = await import("/controller.ts" as string);
      await chat.sync();
      await chat.sync();
    });
    await expect(viewer.locator(".chat-tab-label .ant-badge")).toHaveText("1");
    await viewer.bringToFront();
    await viewer.getByRole("button", { name: "查看消息", exact: true }).click();
    await expect(
      viewer.locator(".chat-message").filter({ hasText: "恢复后补齐验证" }),
    ).toHaveCount(1);
    await viewer.screenshot({ path: ".local/chat-realtime/chat.png" });
    await viewer.getByRole("button", { name: "离开房间", exact: true }).click();
    await expect(viewer.locator(".current-room")).toHaveCount(0);
    console.log(
      JSON.stringify({
        trustedRealtimePush: true,
        pushWithoutPolling: true,
        unreadAndLobbyNavigation: true,
        historyScrollPreserved: true,
        replayDeduplicated: true,
      }),
    );
  } finally {
    await a.close();
    await b.close();
  }
});

test("desktop receives realtime chat while the members tab is open", async ({
  browser,
}) => {
  test.skip(
    process.env.CINEGATHER_CHAT_DESKTOP_TEST !== "1",
    "Opt-in local Electron build",
  );
  const work = await mkdtemp(join(tmpdir(), "cg-chat-"));
  const app = await electron.launch({
    args: [
      resolve("apps/desktop/out/main/index.cjs"),
      `--user-data-dir=${work}`,
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
    ],
  });
  const context = await browser.newContext();
  try {
    const receiver = await app.firstWindow(),
      sender = await context.newPage();
    await registerTestAccount(receiver, "桌面聊天实时接收测试");
    await receiver
      .getByRole("button", { name: "创建私人房间", exact: true })
      .click();
    await receiver.getByLabel("房间名称").fill("桌面聊天实时本机验证");
    await receiver
      .getByRole("button", { name: "创建并进入", exact: true })
      .click();
    await expect(receiver.locator(".connection")).toContainText("已连接");
    const code = (
      await receiver
        .getByRole("button", { name: "复制房间号", exact: true })
        .innerText()
    ).trim();
    await sender.goto("/");
    await registerTestAccount(sender, "桌面聊天实时发布测试");
    await sender.getByRole("button", { name: "加入房间", exact: true }).click();
    await sender.getByLabel("房间号或邀请链接").fill(code);
    await sender.getByRole("button", { name: "进入房间", exact: true }).click();
    await expect(sender.locator(".connection")).toContainText("已连接");
    await sender.getByRole("tab", { name: /聊天/ }).click();
    await send(sender, "桌面实时提醒验证");
    await expect(receiver.locator(".chat-tab-label .ant-badge")).toHaveText(
      "1",
      { timeout: 2000 },
    );
    await expect(receiver.locator(".ant-notification")).toContainText(
      "桌面实时提醒验证",
    );
    await app.evaluate(({ app, BrowserWindow }) => {
      app.focus({ steal: true });
      BrowserWindow.getAllWindows()[0]?.focus();
    });
    await receiver
      .getByRole("button", { name: "查看消息", exact: true })
      .click();
    await expect(receiver.locator(".chat-message")).toContainText(
      "桌面实时提醒验证",
    );
    await expect(receiver.locator(".chat-tab-label .ant-badge")).toBeEmpty();
    await receiver.screenshot({
      path: ".local/chat-realtime/chat-desktop.png",
    });
    await receiver
      .getByRole("button", { name: "离开房间", exact: true })
      .click();
  } finally {
    await context.close();
    await app.close();
    await rm(work, { recursive: true, force: true });
  }
});
