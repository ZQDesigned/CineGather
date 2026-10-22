import {
  test,
  expect,
  _electron as electron,
  type Page,
} from "@playwright/test";
import { resolve, join } from "node:path";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

async function pixels(page: Page, url: string) {
  return page.evaluate(async (url) => {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    return {
      width: canvas.width,
      height: canvas.height,
      rgb: Array.from(
        context.getImageData(
          Math.floor(canvas.width * 0.2),
          Math.floor(canvas.height * 0.6),
          1,
          1,
        ).data,
      ).slice(0, 3),
    };
  }, url);
}

test("real Mac window and display thumbnails match source pixels, refresh and still publish the selected window", async () => {
  const executablePath = resolve(
    "apps/desktop/release/mac-arm64/CineGather.app/Contents/MacOS/CineGather",
  );
  test.skip(
    process.platform !== "darwin" ||
      process.env.CINEGATHER_NATIVE_PREVIEW_TEST !== "1" ||
      !existsSync(executablePath),
    "Opt-in: requires an unlocked Mac and the already authorized capture helper.",
  );
  test.setTimeout(120_000);
  const profile = await mkdtemp(join(tmpdir(), "cg-thumbnail-test-"));
  const fixture = await electron.launch({
    args: [resolve("tests/fixtures/thumbnail-source.mjs")],
    timeout: 30000,
  });
  const control = await fixture.firstWindow();
  const app = await electron.launch({
    executablePath,
    args: [
      `--user-data-dir=${profile}`,
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
    ],
    timeout: 30000,
  });
  const report: Record<string, unknown> = {};
  let page: Page | undefined;
  try {
    page = await app.firstWindow();
    await page.getByLabel("你的昵称").fill("缩略图实机验证");
    await page.getByRole("button", { name: "进入映聚", exact: true }).click();
    await page
      .getByRole("button", { name: "创建私人房间", exact: true })
      .click();
    await page.getByLabel("房间名称").fill("真实缩略图与选择验证");
    await page.getByRole("button", { name: "创建并进入", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "选择屏幕开始共享" }),
    ).toBeEnabled();
    const sources = await page.evaluate(() => window.desktop!.sources());
    const windowSource = sources.find((s) =>
      s.name.includes("CG Thumbnail Test Window"),
    )!;
    const screen = sources.find((s) => s.kind === "screen")!;
    expect(windowSource).toBeTruthy();
    expect(screen).toBeTruthy();
    const start = performance.now();
    const frames = await page.evaluate(
      (ids) => window.desktop!.sourceThumbnails!(ids),
      [windowSource.id, screen.id],
    );
    report.batchMs = performance.now() - start;
    for (const frame of frames) {
      expect(frame.thumbnail).toMatch(/^data:image\/jpeg;base64,/);
      expect(frame.thumbnail.length).toBeLessThan(55000);
      const image = await pixels(page, frame.thumbnail);
      expect(image.width).toBeGreaterThan(0);
      expect(image.width).toBeLessThanOrEqual(400);
      expect(image.height).toBeGreaterThan(0);
      expect(image.height).toBeLessThanOrEqual(225);
      if (frame.id === windowSource.id) {
        expect(image.rgb[2]! - image.rgb[0]!).toBeGreaterThan(100);
        report.initialWindow = image;
      } else report.screen = image;
    }
    await page.getByRole("button", { name: "选择屏幕开始共享" }).click();
    const card = page
      .locator(".source-card")
      .filter({ hasText: "CG Thumbnail Test Window" });
    const preview = card.locator(".source-preview img");
    await expect(preview).toBeVisible({ timeout: 30000 });
    await card.getByRole("radio").check();
    const previous = (await preview.getAttribute("src"))!;
    await control.evaluate(() => {
      document.body.style.background = "#e86420";
      document.querySelector("strong")!.textContent = "CG · PREVIEW B";
    });
    await page.getByRole("button", { name: "刷新预览", exact: true }).click();
    await expect(preview).not.toHaveAttribute("src", previous, {
      timeout: 30000,
    });
    const changed = (await preview.getAttribute("src"))!;
    const refreshed = await pixels(page, changed);
    expect(refreshed.rgb[0]! - refreshed.rgb[2]!).toBeGreaterThan(100);
    report.refreshedWindow = refreshed;
    await mkdir(".local/thumbnails", { recursive: true });
    await page.screenshot({ path: ".local/thumbnails/mac-picker-window.png" });
    await page.getByRole("tab", { name: "整个屏幕", exact: true }).click();
    await expect(page.locator(".source-preview img").first()).toBeVisible();
    await page.screenshot({ path: ".local/thumbnails/mac-picker-screen.png" });
    await page.getByRole("tab", { name: "应用窗口", exact: true }).click();
    await card.getByRole("radio").check();
    await page.getByRole("button", { name: "确认共享", exact: true }).click();
    await expect(page.locator(".sharing-banner")).toBeVisible({
      timeout: 20000,
    });
    await expect
      .poll(
        () =>
          page!
            .locator(".stage video")
            .evaluate((video: HTMLVideoElement) => video.videoWidth),
        { timeout: 20000 },
      )
      .toBeGreaterThan(0);
    await page
      .locator(".sharing-banner")
      .getByRole("button", { name: "停止共享", exact: true })
      .click();
    await expect(page.locator(".sharing-banner")).toHaveCount(0);
    report.publishedSelectedWindow = true;
    await writeFile(
      ".local/thumbnails/mac-validation.json",
      JSON.stringify(report, null, 2),
    );
  } finally {
    if (page && !page.isClosed()) {
      await page.keyboard.press("Escape").catch(() => {});
      await page
        .getByRole("button", { name: "离开房间", exact: true })
        .click({ timeout: 5000 })
        .catch(() => {});
    }
    await app.close();
    await fixture.close();
    await rm(profile, { recursive: true, force: true });
  }
});
