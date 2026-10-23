import { test, expect, type Page } from "@playwright/test";

async function guest(page: Page, name: string) {
  await page.goto("/");
  await page.getByLabel("你的昵称").fill(name);
  await page.getByRole("button", { name: "进入映聚", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: `晚上好，${name}` }),
  ).toBeVisible();
}
async function joinDialog(page: Page, value: string) {
  await page.getByRole("button", { name: "加入房间", exact: true }).click();
  await page.getByLabel("房间号或邀请链接").fill(value);
}
async function submitJoin(page: Page) {
  await expect(
    page.getByRole("button", { name: "进入房间", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "进入房间", exact: true }).click();
}
async function leave(page: Page) {
  await page.getByRole("button", { name: "离开房间", exact: true }).click();
  await expect(page.locator(".home")).toBeVisible();
}

test("normal rooms show an inline copyable code and admit another client without an invitation", async ({
  page,
  context,
  browser,
}) => {
  const otherContext = await browser.newContext({
    permissions: ["microphone"],
  });
  try {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await guest(page, "普通房主");
    await page
      .getByRole("button", { name: "创建私人房间", exact: true })
      .click();
    await page.getByLabel("房间名称").fill("房间号直接加入");
    await page.getByText("加密房", { exact: true }).click();
    await page
      .getByLabel("房间密码", { exact: true })
      .fill("discarded-password");
    await page.getByText("普通房", { exact: true }).click();
    await expect(page.getByLabel("房间密码", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "创建并进入" }).click();
    const title = page.getByRole("heading", {
      name: "房间号直接加入",
      exact: true,
    });
    await expect(title).toBeVisible();
    await expect(
      page.getByText("你们的私人放映厅", { exact: true }),
    ).toHaveCount(0);
    await expect(page.locator(".room-title-row .ant-tag")).toHaveText("普通房");
    const codeButton = page.getByRole("button", {
      name: "复制房间号",
      exact: true,
    });
    const code = (await codeButton.innerText()).trim();
    expect(code).toMatch(/^[A-F0-9]{8}$/);
    await codeButton.click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      code,
    );
    for (const size of [
      { width: 980, height: 680 },
      { width: 1440, height: 900 },
      { width: 1800, height: 720 },
    ]) {
      await page.setViewportSize(size);
      const heading = await title.boundingBox();
      const number = await codeButton.boundingBox();
      expect(number!.x).toBeGreaterThanOrEqual(heading!.x + heading!.width);
      expect(
        Math.abs(
          number!.y + number!.height / 2 - heading!.y - heading!.height / 2,
        ),
      ).toBeLessThan(4);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollHeight <= innerHeight,
        ),
      ).toBe(true);
    }
    await page.screenshot({ path: ".local/room-access/normal-room.png" });
    const friend = await otherContext.newPage();
    await guest(friend, "号码新成员");
    await joinDialog(friend, code.toLowerCase());
    await submitJoin(friend);
    await expect(
      friend.getByRole("heading", { name: "房间号直接加入", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".members-list .member")).toHaveCount(2);
    await leave(friend);
    await leave(page);
    for (const size of [
      { width: 980, height: 680 },
      { width: 1150, height: 780 },
      { width: 1440, height: 900 },
    ]) {
      await page.setViewportSize(size);
      const card = page
        .locator(".room-card")
        .filter({ hasText: "房间号直接加入" });
      const box = await card.boundingBox();
      const top = await card.locator(".room-card-top").boundingBox();
      const footer = await card.locator(".room-card-footer").boundingBox();
      expect(box!.height).toBeLessThan(170);
      expect(footer!.y).toBeGreaterThanOrEqual(top!.y + top!.height);
      expect(footer!.y + footer!.height).toBeLessThan(box!.y + box!.height);
      expect(
        await card.evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollHeight <= innerHeight,
        ),
      ).toBe(true);
    }
    await page.screenshot({ path: ".local/room-access/home-cards.png" });
  } finally {
    await otherContext.close();
  }
});

test("encrypted rooms require a password on manual reentry and valid invitations bypass it", async ({
  page,
  browser,
}) => {
  const otherContext = await browser.newContext({
    permissions: ["microphone"],
  });
  try {
    await guest(page, "加密房主");
    await page
      .getByRole("button", { name: "创建私人房间", exact: true })
      .click();
    await page.getByLabel("房间名称").fill("加密房入房实测");
    await page.getByText("加密房", { exact: true }).click();
    await page.getByRole("button", { name: "创建并进入" }).click();
    await expect(
      page.getByText("请设置房间密码", { exact: true }),
    ).toBeVisible();
    const password = "e2e-private-123";
    await page.getByLabel("房间密码", { exact: true }).fill(password);
    await page.getByRole("button", { name: "创建并进入" }).click();
    await expect(
      page.getByRole("heading", { name: "加密房入房实测", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".room-title-row .ant-tag")).toHaveText("加密房");
    const code = (
      await page
        .getByRole("button", { name: "复制房间号", exact: true })
        .innerText()
    ).trim();
    await page.getByRole("button", { name: "邀请朋友", exact: true }).click();
    const invitation = await page.getByLabel("房间邀请").inputValue();
    await page.getByRole("button", { name: "关闭对话框" }).click();
    const friend = await otherContext.newPage();
    await guest(friend, "加密房成员");
    await joinDialog(friend, code);
    await submitJoin(friend);
    await expect(
      friend.locator(".ant-notification").getByRole("alert"),
    ).toContainText("请输入房间密码");
    const passwordInput = friend.getByLabel("房间密码（加密房必填）", {
      exact: true,
    });
    await passwordInput.fill("wrong");
    await submitJoin(friend);
    await expect(
      friend.locator(".ant-notification").getByRole("alert"),
    ).toContainText("房间密码不正确");
    await passwordInput.fill(password);
    await submitJoin(friend);
    await expect(page.locator(".members-list .member")).toHaveCount(2);
    expect(
      await friend.evaluate(() => JSON.stringify(localStorage)),
    ).not.toContain(password);
    await leave(friend);
    await friend
      .getByRole("button", { name: "进入加密房入房实测", exact: true })
      .click();
    await expect(friend.getByRole("dialog")).toBeVisible();
    await expect(friend.getByLabel("房间号或邀请链接")).toHaveValue(code);
    await expect(passwordInput).toHaveValue("");
    await friend.getByLabel("房间号或邀请链接").fill(invitation);
    await expect(passwordInput).toHaveCount(0);
    await submitJoin(friend);
    await expect(friend.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator(".members-list .member")).toHaveCount(2);
    await friend.screenshot({ path: ".local/room-access/encrypted-room.png" });
    await leave(friend);
    await page.getByRole("button", { name: "邀请朋友", exact: true }).click();
    const revoked = await page.getByLabel("房间邀请").inputValue();
    await page
      .getByRole("button", { name: "撤销这条邀请", exact: true })
      .click();
    await joinDialog(friend, revoked);
    await submitJoin(friend);
    await expect(
      friend.locator(".ant-notification").getByRole("alert"),
    ).toContainText("邀请无效");
    await friend.getByLabel("房间号或邀请链接").fill(code);
    await passwordInput.fill(password);
    await submitJoin(friend);
    await expect(friend.getByRole("dialog")).toHaveCount(0);
    await leave(friend);
    await leave(page);
    await page
      .getByRole("button", { name: "进入加密房入房实测", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "加密房入房实测", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await leave(page);
  } finally {
    await otherContext.close();
  }
});
