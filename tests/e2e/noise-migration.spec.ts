import { test, expect, type Page } from "@playwright/test";
import { defaultSettings } from "../../apps/desktop/src/shared/settings";
import { registerTestAccount } from "./helpers/account";

const noticeName = "降噪设置调整提示";
async function createRoom(page: Page) {
  await page.getByRole("button", { name: "创建私人房间", exact: true }).click();
  await page.getByLabel("房间名称", { exact: true }).fill("降噪升级提示验证");
  await page.getByRole("button", { name: "创建并进入", exact: true }).click();
  await expect(page.locator(".connection")).toContainText("已连接", {
    timeout: 30000,
  });
}

for (const close of ["acknowledge", "escape", "outside", "arrow"] as const) {
  test(`migrated noise hint appears once at the microphone arrow and retains its exit content: ${close}`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.addInitScript(
      (settings) => {
        if (localStorage.getItem("noise-fixture-seeded")) return;
        localStorage.setItem("noise-fixture-seeded", "true");
        localStorage.setItem("cinegather.settings", JSON.stringify(settings));
      },
      {
        ...defaultSettings,
        noiseReduction: "enhanced",
        noiseReductionRevision: 0,
      },
    );
    await page.goto("/");
    await registerTestAccount(page, "降噪迁移体验");
    await expect(page.getByRole("region", { name: noticeName })).toHaveCount(0);
    await page.evaluate((name) => {
      const probe = { entered: false, exiting: false, text: "" };
      Object.assign(window, { noiseHintMotion: probe });
      document.addEventListener("animationstart", (event) => {
        const target = event.target;
        if (!(target instanceof Element) || !target.matches(".ant-popover"))
          return;
        if (!target.querySelector(`[aria-label="${name}"]`)) return;
        if (/In/i.test(event.animationName)) probe.entered = true;
        if (/Out/i.test(event.animationName)) {
          probe.exiting = true;
          probe.text = target.textContent ?? "";
          target.getAnimations().forEach((animation) => animation.pause());
        }
      });
    }, noticeName);
    await createRoom(page);
    const notice = page.getByRole("region", { name: noticeName });
    const arrow = page.getByRole("button", {
      name: "音频快捷设置",
      exact: true,
    });
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("过度抑制人声");
    await expect(notice).toContainText("手动切回增强降噪");
    await notice.evaluate(async (element) => {
      const popup = element.closest(".ant-popover");
      await Promise.all(
        popup
          ?.getAnimations({ subtree: true })
          .map((animation) => animation.finished.catch(() => {})) ?? [],
      );
    });
    const bubble = await notice.boundingBox();
    const anchor = await arrow.boundingBox();
    expect(bubble).toBeTruthy();
    expect(anchor).toBeTruthy();
    expect(bubble!.y + bubble!.height).toBeLessThan(anchor!.y);
    expect(Math.abs(bubble!.x - anchor!.x)).toBeLessThan(300);
    if (close === "acknowledge")
      await page.screenshot({
        path: ".local/default-standard-noise/notice.png",
      });
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            JSON.parse(localStorage.getItem("cinegather.settings")!)
              .noiseReductionNoticePending,
        ),
      )
      .toBe(false);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { noiseHintMotion: { entered: boolean } })
              .noiseHintMotion.entered,
        ),
      )
      .toBe(true);
    if (close === "acknowledge")
      await notice.getByRole("button", { name: "知道了", exact: true }).click();
    else if (close === "escape") await page.keyboard.press("Escape");
    else if (close === "outside")
      await page
        .getByRole("heading", { name: "降噪升级提示验证", exact: true })
        .click();
    else await arrow.click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { noiseHintMotion: { exiting: boolean } })
              .noiseHintMotion.exiting,
        ),
      )
      .toBe(true);
    await expect(notice).toBeAttached();
    await expect(notice).toContainText("手动切回增强降噪");
    await page.evaluate(() =>
      document
        .getAnimations()
        .filter((animation) => animation.playState === "paused")
        .forEach((animation) => animation.finish()),
    );
    await expect(notice).toBeHidden();
    if (close === "acknowledge" || close === "escape")
      await expect(arrow).toBeFocused();
    const panel = page.getByRole("region", {
      name: "音频快捷设置",
      exact: true,
    });
    if (close !== "arrow") await arrow.click();
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("基础降噪");
    if (close === "acknowledge") {
      await panel
        .getByRole("combobox", { name: "麦克风降噪", exact: true })
        .click();
      await page.getByRole("option", { name: "增强降噪", exact: true }).click();
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              JSON.parse(localStorage.getItem("cinegather.settings")!)
                .noiseReduction,
          ),
        )
        .toBe("enhanced");
    }
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await page.getByRole("button", { name: "离开房间", exact: true }).click();
    await expect(page.locator(".connection")).toContainText("未连接房间");
    await page.reload();
    await expect(
      page.getByRole("button", { name: "退出登录", exact: true }),
    ).toBeVisible();
    await createRoom(page);
    await expect(notice).toBeHidden();
    expect(
      await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("cinegather.settings")!)
            .noiseReduction,
      ),
    ).toBe(close === "acknowledge" ? "enhanced" : "basic");
    await page.getByRole("button", { name: "离开房间", exact: true }).click();
  });
}

test("new profiles default to basic without an adjustment hint", async ({
  page,
}) => {
  await page.goto("/");
  await registerTestAccount(page, "默认降噪体验");
  await createRoom(page);
  await expect(page.getByRole("region", { name: noticeName })).toHaveCount(0);
  await page.getByRole("button", { name: "音频快捷设置", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "音频快捷设置", exact: true }),
  ).toContainText("基础降噪");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "离开房间", exact: true }).click();
});
