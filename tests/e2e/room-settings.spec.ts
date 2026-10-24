import { test, expect, type Page } from "@playwright/test";
import { registerTestAccount } from "./helpers/account";
test("owner settings update the shared UI and grow a live two-seat room to four without reconnecting", async ({
  page,
  browser,
}) => {
  test.setTimeout(90000);
  const others = await Promise.all(
    [1, 2, 3].map(() => browser.newContext({ permissions: ["microphone"] })),
  );
  const guests = await Promise.all(others.map((c) => c.newPage()));
  let ownerJoins = 0;
  page.on("request", (r) => {
    if (
      r.method() === "POST" &&
      /\/rooms\/[^/]+\/join$/.test(new URL(r.url()).pathname)
    )
      ownerJoins++;
  });
  const enter = async (p: Page, index: number, code: string) => {
    await p.goto("/");
    await registerTestAccount(p, `房间设置观众${index}`);
    await p.getByRole("button", { name: "加入房间", exact: true }).click();
    await p.getByLabel("房间号或邀请链接").fill(code);
    await p.getByRole("button", { name: "进入房间", exact: true }).click();
    await expect(p.locator(".connection")).toContainText("已连接");
  };
  try {
    await page.goto("/");
    await registerTestAccount(page, "房间设置房主");
    await page
      .getByRole("button", { name: "创建私人房间", exact: true })
      .click();
    await page.getByLabel("房间名称").fill("可调整的双人房");
    await page.getByLabel("房间人数").click();
    await page.getByRole("option", { name: "2 人", exact: true }).click();
    await page.getByRole("button", { name: "创建并进入", exact: true }).click();
    await expect(page.locator(".connection")).toContainText("已连接");
    const code = (
      await page
        .getByRole("button", { name: "复制房间号", exact: true })
        .innerText()
    ).trim();
    await enter(guests[0]!, 1, code);
    await expect(
      guests[0]!.getByRole("button", { name: "房间设置", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "房间设置", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "房间设置", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "房间设置", exact: true });
    await expect(dialog.getByLabel("房间名称")).toHaveValue("可调整的双人房");
    await dialog.getByLabel("房间名称").fill("房主修改后的房间");
    // Polling room metadata must not overwrite an unsaved draft.
    await page.waitForResponse(
      (r) =>
        r.request().method() === "GET" &&
        /\/api\/v1\/rooms\/[^/]+$/.test(new URL(r.url()).pathname),
    );
    await expect(dialog.getByLabel("房间名称")).toHaveValue("房主修改后的房间");
    await dialog.getByLabel("人数上限").click();
    await page.getByRole("option", { name: "4 人", exact: true }).click();
    await page.screenshot({ path: ".local/room-settings/dialog.png" });
    await dialog.getByRole("button", { name: "保存修改", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "房主修改后的房间", exact: true }),
    ).toBeVisible();
    await expect(
      guests[0]!.getByRole("heading", {
        name: "房主修改后的房间",
        exact: true,
      }),
    ).toBeVisible();
    expect(ownerJoins).toBe(1);
    await enter(guests[1]!, 2, code);
    await enter(guests[2]!, 3, code);
    await expect(page.locator(".members-list .member")).toHaveCount(4);
    await page.getByRole("button", { name: "房间设置", exact: true }).click();
    await expect(dialog.getByLabel("房间名称")).toHaveValue("房主修改后的房间");
    await dialog.getByLabel("人数上限").click();
    await expect(
      page.getByRole("option", { name: "2 人", exact: true }),
    ).toHaveAttribute("aria-disabled", "true");
    await expect(
      page.getByRole("option", { name: "3 人", exact: true }),
    ).toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("Escape");
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(ownerJoins).toBe(1);
    await page.screenshot({ path: ".local/room-settings/four-clients.png" });
  } finally {
    for (const p of [...guests, page]) {
      const close = p.getByRole("button", { name: "关闭对话框", exact: true });
      if (await close.count()) await close.click();
      const leave = p.getByRole("button", { name: "离开房间", exact: true });
      if (await leave.count()) await leave.click();
    }
    for (const c of others) await c.close();
  }
});
