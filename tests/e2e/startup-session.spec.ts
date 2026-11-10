import { test, expect } from "@playwright/test";
import { registerTestAccount } from "./helpers/account";

test("restoring a saved login never flashes the account form", async ({
  page,
}) => {
  await page.goto("/");
  await registerTestAccount(page, "启动恢复验证");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/v1/me", async (route) => {
    await gate;
    await route.continue();
  });
  await page.addInitScript(() => {
    let flashed = false;
    const observer = new MutationObserver(() => {
      if (
        document.querySelector('.welcome-card input[autocomplete="username"]')
      )
        flashed = true;
    });
    observer.observe(document, { childList: true, subtree: true });
    Object.assign(window, { loginFormFlashed: () => flashed });
  });
  try {
    await page.reload();
    await expect(
      page.getByRole("status", { name: "正在进入映聚", exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("用户名", { exact: true })).toHaveCount(0);
    const logo = page.locator(".session-film.lucide-clapperboard");
    await expect(logo).toBeVisible();
    expect(await logo.innerHTML()).toBe(
      await page.locator(".orbit-center .lucide-clapperboard").innerHTML(),
    );
    const iconBox = (await logo.boundingBox())!,
      ringBox = (await page.locator(".session-ring").boundingBox())!;
    expect(
      Math.abs(iconBox.x + iconBox.width / 2 - ringBox.x - ringBox.width / 2),
    ).toBeLessThan(0.1);
    expect(
      Math.abs(iconBox.y + iconBox.height / 2 - ringBox.y - ringBox.height / 2),
    ).toBeLessThan(0.1);
    await page.screenshot({
      path: ".local/desktop-resource-1/startup-loading.png",
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(page.locator(".session-orbit")).toHaveCSS(
      "animation-name",
      "none",
    );
    await expect(logo).toHaveCSS("animation-name", "none");
    release();
    await expect(
      page.getByRole("heading", { name: /^晚上好，启动恢复验证/ }),
    ).toBeVisible();
    expect(
      await page.evaluate(() =>
        (
          window as unknown as { loginFormFlashed(): boolean }
        ).loginFormFlashed(),
      ),
    ).toBe(false);
  } finally {
    release();
  }
});

for (const status of [401, 503])
  test(`failed login recovery (${status}) reveals a usable form`, async ({
    page,
  }) => {
    await page.addInitScript(() =>
      localStorage.setItem("cinegather.session", "startup-invalid-credential"),
    );
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/v1/me", async (route) => {
      await gate;
      await route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify({
          code: status === 401 ? "UNAUTHENTICATED" : "SERVICE_UNAVAILABLE",
          message: "启动恢复不可用",
        }),
      });
    });
    try {
      await page.goto("/");
      await expect(
        page.getByRole("status", { name: "正在进入映聚", exact: true }),
      ).toBeVisible();
      await expect(page.getByLabel("用户名", { exact: true })).toHaveCount(0);
      release();
      await expect(page.getByLabel("用户名", { exact: true })).toBeEditable();
      await expect(
        page.getByRole("status", { name: "正在进入映聚", exact: true }),
      ).toHaveCount(0);
      expect(
        await page.evaluate(() => localStorage.getItem("cinegather.session")),
      ).toBe(status === 401 ? null : "startup-invalid-credential");
    } finally {
      release();
    }
  });

test("without a saved credential the account form opens without requesting the account", async ({
  page,
}) => {
  let reads = 0;
  page.on("request", (r) => {
    if (new URL(r.url()).pathname === "/api/v1/me") reads++;
  });
  await page.goto("/");
  await expect(page.getByLabel("用户名", { exact: true })).toBeEditable();
  expect(reads).toBe(0);
});

test("tooltip text has symmetric vertical spacing at the custom control size", async ({
  page,
}) => {
  await page.goto("/");
  await registerTestAccount(page, "提示布局验证");
  await page.getByRole("button", { name: "创建私人房间", exact: true }).click();
  await page.getByLabel("房间名称", { exact: true }).fill("提示布局验证");
  await page.getByRole("button", { name: "创建并进入", exact: true }).click();
  try {
    await page.getByRole("button", { name: "复制房间号", exact: true }).hover();
    const tooltip = page.getByRole("tooltip", {
      name: "复制房间号",
      exact: true,
    });
    await expect(tooltip).toBeVisible();
    await tooltip.evaluate(async (el) => {
      await Promise.all(
        el
          .closest(".ant-tooltip")!
          .getAnimations({ subtree: true })
          .map((a) => a.finished.catch(() => {})),
      );
    });
    const spacing = await tooltip.evaluate((el) => {
      const box = el.getBoundingClientRect(),
        css = getComputedStyle(el),
        range = document.createRange();
      range.selectNodeContents(el);
      const text = range.getBoundingClientRect();
      return {
        top: text.top - box.top,
        bottom: box.bottom - text.bottom,
        extra:
          box.height -
          parseFloat(css.paddingTop) -
          parseFloat(css.paddingBottom) -
          parseFloat(css.lineHeight),
      };
    });
    console.log("Tooltip spacing", spacing);
    expect(Math.abs(spacing.top - spacing.bottom)).toBeLessThanOrEqual(3);
    expect(spacing.extra).toBeLessThanOrEqual(1);
    await tooltip.screenshot({
      path: ".local/desktop-resource-1/tooltip-centered.png",
    });
  } finally {
    await page.mouse.move(0, 0);
    await page.getByRole("button", { name: "离开房间", exact: true }).click();
  }
});
