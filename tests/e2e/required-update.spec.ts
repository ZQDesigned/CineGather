import { nextClientVersion } from "./helpers/client-version";
import { test, expect } from "@playwright/test";
test("browser mandatory update cannot be dismissed and offers refresh rather than desktop install", async ({
  page,
}) => {
  await page.route("**/api/v1/client-policy", (route) =>
    route.fulfill({
      json: {
        minimumVersions: {
          win32: "0.0.0",
          darwin: "0.0.0",
          web: nextClientVersion,
        },
        reason: "共享协议已升级，请刷新后继续。",
      },
    }),
  );
  await page.goto("/");
  const gate = page.getByRole("dialog", { name: "需要更新映聚" });
  await expect(gate).toBeVisible();
  await expect(gate).toContainText("共享协议已升级");
  await page.keyboard.press("Escape");
  await expect(gate).toBeVisible();
  await expect(
    gate.getByRole("button", { name: "稍后", exact: true }),
  ).toHaveCount(0);
  await expect(
    gate.getByRole("button", { name: "刷新页面", exact: true }),
  ).toBeVisible();
  await page.route("**/api/v1/client-policy", (route) =>
    route.fulfill({
      json: {
        minimumVersions: { win32: "0.0.0", darwin: "0.0.0", web: "0.0.0" },
        reason: "已恢复兼容",
      },
    }),
  );
  await gate.getByRole("button", { name: "刷新页面", exact: true }).click();
  await expect(gate).toHaveCount(0);
});
test("network failure alone never displays a mandatory update gate", async ({
  page,
}) => {
  await page.route("**/api/v1/client-policy", (route) => route.abort("failed"));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "欢迎来到映聚", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("dialog", { name: "需要更新映聚" })).toHaveCount(
    0,
  );
});

test("426 during a live room stops media, leaves the room and retains login behind the mandatory gate", async ({
  page,
}) => {
  const { registerTestAccount } = await import("./helpers/account");
  await page.goto("/");
  await registerTestAccount(page, "兼容升级回归");
  await page.getByRole("button", { name: "创建私人房间", exact: true }).click();
  await page.getByLabel("房间名称").fill("强制升级安全退出测试");
  await page.getByRole("button", { name: "创建并进入", exact: true }).click();
  await expect(page.locator(".connection")).toContainText("已连接");
  await page.getByRole("tab", { name: "聊天", exact: true }).click();
  let left = false;
  page.on("response", (response) => {
    if (response.url().endsWith("/leave") && response.ok()) left = true;
  });
  await page.route("**/api/v1/rooms/*/messages", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await route.fulfill({
      status: 426,
      headers: {
        "Content-Type": "application/json",
        "X-CineGather-Min-Version": nextClientVersion,
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Expose-Headers": "X-CineGather-Min-Version",
      },
      body: JSON.stringify({
        code: "CLIENT_UPDATE_REQUIRED",
        message: "聊天协议已升级",
        requestId: "test",
      }),
    });
  });
  await page.getByPlaceholder("和朋友说点什么…").fill("触发兼容检查");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  const gate = page.getByRole("dialog", { name: "需要更新映聚" });
  await expect(gate).toBeVisible();
  await expect(gate).toContainText("聊天协议已升级");
  await expect.poll(() => left).toBe(true);
  await expect(page.locator(".connection")).toContainText("未连接房间");
  expect(
    await page.evaluate(() =>
      Boolean(localStorage.getItem("cinegather.session")),
    ),
  ).toBe(true);
});
