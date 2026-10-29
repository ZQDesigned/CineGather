import { test, expect } from "@playwright/test";
import { registerTestAccount } from "./helpers/account";

test("notification preferences, merged history, sharing privacy and account isolation survive real UI transitions", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const delivery: { title: string; body?: string }[] = [];
    const instances: { onclick?: () => void }[] = [];
    class Notice {
      static permission = "granted";
      onclick?: () => void;
      onclose?: () => void;
      constructor(title: string, options: { body?: string }) {
        instances.push(this);
        delivery.push({ title, body: options.body });
      }
      close() {
        this.onclose?.();
      }
    }
    Object.assign(window, {
      Notification: Notice,
      notificationTestDelivery: delivery,
      notificationTestInstances: instances,
    });
    Object.defineProperty(document, "hasFocus", {
      configurable: true,
      value: () => false,
    });
  });
  await page.goto("/");
  await registerTestAccount(page, "通知偏好验证");
  const publish = async (id: string, body: string, groupId = "device-group") =>
    page.evaluate(
      async ({ id, body, groupId }) => {
        const { publishClientNotification } = await import(
          "/client-notifications.ts" as string
        );
        publishClientNotification({
          eventId: id,
          groupId,
          category: "system",
          title: "设备提醒",
          body,
          target: "diagnostics",
        });
      },
      { id, body, groupId },
    );
  await publish("one", "第一条提醒");
  await publish("two", "第二条提醒");
  await publish("two", "重复内容不应替换");
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { notificationTestDelivery: unknown[] })
          .notificationTestDelivery.length,
    ),
  ).toBe(1);
  await page
    .getByRole("button", { name: "通知，1 条未读", exact: true })
    .click();
  const inbox = page.locator('[aria-label="通知中心"]');
  await expect(inbox).toContainText("第二条提醒");
  await expect(inbox.locator("article")).toHaveCount(1);
  await expect(inbox).not.toContainText("重复内容不应替换");
  await expect(
    inbox.getByRole("button", { name: "全部已读", exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(350);
  await page.screenshot({
    path: ".local/notifications-watch/notification-center.png",
    animations: "disabled",
  });
  await inbox.getByRole("button", { name: "全部已读", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "通知", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "通知", exact: true }).click();
  await page.evaluate(async () => {
    let active = true,
      exits = 0;
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get: () => (active ? document.querySelector(".app") : null),
    });
    document.exitFullscreen = async () => {
      active = false;
      exits++;
    };
    Object.assign(window, { notificationExitProbe: () => exits });
    const { update } = await import("/store.ts" as string);
    update({ cinema: true });
    (
      window as unknown as {
        notificationTestInstances: { onclick?: () => void }[];
      }
    ).notificationTestInstances[0]!.onclick?.();
  });
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as unknown as { notificationExitProbe: () => number }
        ).notificationExitProbe(),
      ),
    )
    .toBe(1);
  await expect(page.locator(".app")).not.toHaveClass(/cinema/);
  await expect(
    page.getByRole("dialog", { name: "连接诊断", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "关闭对话框", exact: true }).click();
  await page.getByRole("menuitem", { name: "设置与设备", exact: true }).click();
  await page.getByRole("tab", { name: "通知", exact: true }).click();
  await page.getByRole("switch", { name: "免打扰", exact: true }).click();
  await page.screenshot({
    path: ".local/notifications-watch/notification-settings.png",
    animations: "disabled",
  });
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await publish("quiet", "免打扰仍保留历史", "quiet-group");
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { notificationTestDelivery: unknown[] })
          .notificationTestDelivery.length,
    ),
  ).toBe(1);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "退出登录", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "通知，1 条未读", exact: true })
    .click();
  await expect(inbox).toContainText("免打扰仍保留历史");
  await expect(inbox).not.toContainText("Failed to fetch");
  await page
    .getByRole("button", { name: "通知，1 条未读", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "设置与设备", exact: true }).click();
  await page.getByRole("tab", { name: "通知", exact: true }).click();
  await expect(
    page.getByRole("switch", { name: "免打扰", exact: true }),
  ).toHaveAttribute("aria-checked", "true");
  await page.getByRole("switch", { name: "免打扰", exact: true }).click();
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await page.evaluate(async () => {
    const { update } = await import("/store.ts" as string);
    update({ shareState: "publishing" });
  });
  await publish("private", "不应泄露的通知正文", "private-group");
  const delivery = await page.evaluate(
    () =>
      (
        window as unknown as {
          notificationTestDelivery: { title: string; body?: string }[];
        }
      ).notificationTestDelivery,
  );
  expect(delivery.at(-1)).toEqual({ title: "映聚", body: "收到一条新提醒" });
  await page.evaluate(async () => {
    const { update } = await import("/store.ts" as string);
    update({ shareState: "idle" });
  });
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "登录映聚", exact: true }),
  ).toBeVisible();
  await registerTestAccount(page, "通知隔离验证");
  await page.getByRole("button", { name: "通知", exact: true }).click();
  await expect(inbox).toContainText("暂无通知");
  const beforeErrors = await page.evaluate(
    () =>
      (window as unknown as { notificationTestDelivery: unknown[] })
        .notificationTestDelivery.length,
  );
  const reportFailure = () =>
    page.evaluate(async () => {
      const { update } = await import("/store.ts" as string);
      update({ error: "共享采集暂时不可用" });
    });
  await reportFailure();
  await expect(inbox).toContainText("共享采集暂时不可用");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { notificationTestDelivery: unknown[] })
            .notificationTestDelivery.length,
      ),
    )
    .toBe(beforeErrors + 1);
  await page.waitForTimeout(50);
  await reportFailure();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const { useApp } = await import("/store.ts" as string);
        return useApp.getState().error;
      }),
    )
    .toBeUndefined();
  expect(
    await page.evaluate(async () => {
      const { useApp } = await import("/store.ts" as string);
      return useApp
        .getState()
        .notifications.find(
          (item: { id: string }) => item.id === "operation-error",
        )?.count;
    }),
  ).toBe(1);
});

test("an upgrade resets notification volume once and later saved levels survive reloading", async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (localStorage.getItem("notification-volume-fixture")) return;
    localStorage.setItem("notification-volume-fixture", "seeded");
    localStorage.setItem(
      "cinegather.settings",
      JSON.stringify({
        minimizeToTray: true,
        pushToTalk: false,
        pttShortcut: "CommandOrControl+Shift+Space",
        muteShortcut: "CommandOrControl+Shift+M",
        quality: "cinema",
        inputDevice: "",
        outputDevice: "",
        notifications: { volume: 12, sound: false, doNotDisturb: true },
      }),
    );
  });
  await page.goto("/");
  const saved = () =>
    page.evaluate(() =>
      JSON.parse(localStorage.getItem("cinegather.settings")!),
    );
  await expect.poll(async () => (await saved()).notifications.volume).toBe(100);
  expect((await saved()).notifications).toMatchObject({
    sound: false,
    doNotDisturb: true,
  });
  const open = async () => {
    await page
      .getByRole("menuitem", { name: "设置与设备", exact: true })
      .click();
    await page.getByRole("tab", { name: "通知", exact: true }).click();
  };
  await open();
  const slider = page.getByRole("slider");
  await expect(slider).toHaveAttribute("aria-valuenow", "100");
  await slider.focus();
  await slider.press("ArrowLeft");
  await expect(slider).toHaveAttribute("aria-valuenow", "99");
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect.poll(async () => (await saved()).notifications.volume).toBe(99);
  await page.reload();
  await open();
  await expect(page.getByRole("slider")).toHaveAttribute("aria-valuenow", "99");
  expect((await saved()).notifications).toMatchObject({
    volume: 99,
    sound: false,
    doNotDisturb: true,
  });
});
