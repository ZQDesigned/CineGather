import { test, expect, type Page } from "@playwright/test";
import { registerTestAccount } from "./helpers/account";
async function menu(page: Page, name: string, action: string) {
  await page
    .getByRole("button", { name: `${name}的成员操作`, exact: true })
    .click();
  await page.getByRole("menuitem", { name: action, exact: true }).click();
}
async function capture(page: Page) {
  await page.evaluate(() => {
    navigator.mediaDevices.getDisplayMedia = async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 360;
      const ctx = canvas.getContext("2d")!;
      const timer = setInterval(() => {
        ctx.fillStyle = `hsl(${Date.now() % 360}, 80%, 40%)`;
        ctx.fillRect(0, 0, 640, 360);
      }, 80);
      const stream = canvas.captureStream(12);
      const video = stream.getVideoTracks()[0]!;
      const settings = video.getSettings.bind(video);
      video.getSettings = () => ({ ...settings(), displaySurface: "browser" });
      const audio = new AudioContext();
      const tone = audio.createOscillator(),
        out = audio.createMediaStreamDestination();
      tone.connect(out);
      tone.start();
      stream.addTrack(out.stream.getAudioTracks()[0]!);
      Object.assign(window, { captureTracks: stream.getTracks() });
      video.addEventListener("ended", () => {
        clearInterval(timer);
        void audio.close();
      });
      return stream;
    };
  });
}
async function startShare(page: Page) {
  await page
    .getByRole("button", { name: "选择屏幕开始共享", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("checkbox", { name: "共享声音", exact: true }).check();
  await dialog.getByRole("button", { name: "选择并共享", exact: true }).click();
  await expect(page.locator(".sharing-banner")).toBeVisible();
}
async function join(page: Page, name: string, code: string) {
  await page.goto("/");
  await registerTestAccount(page, name);
  await page.getByRole("button", { name: "加入房间", exact: true }).click();
  await page.getByLabel("房间号或邀请链接").fill(code);
  await page.getByRole("button", { name: "进入房间", exact: true }).click();
}
async function create(page: Page) {
  await page.goto("/");
  await registerTestAccount(page, "管理房主");
  await page.getByRole("button", { name: "创建私人房间", exact: true }).click();
  await page.getByLabel("房间名称").fill("房主操作实测");
  await page.getByRole("button", { name: "创建并进入", exact: true }).click();
  await expect(page.locator(".connection")).toContainText("已连接");
  return (
    await page
      .getByRole("button", { name: "复制房间号", exact: true })
      .innerText()
  ).trim();
}
async function leave(page: Page) {
  if (page.isClosed()) return;
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const exit = page.getByRole("button", { name: "离开房间", exact: true });
  if (await exit.count()) await exit.click();
  await expect(page.locator(".connection")).toContainText("未连接房间");
}
test("owner stops/preempts real media, mutes without unmuting, and transfers controls to a live member", async ({
  page,
  context,
  browser,
}) => {
  test.setTimeout(90000);
  await context.grantPermissions(["microphone"]);
  const other = await browser.newContext({ permissions: ["microphone"] });
  const member = await other.newPage();
  try {
    const code = await create(page);
    await join(member, "被管理成员", code);
    await expect(page.locator(".members-list .member")).toHaveCount(2);
    await expect(
      member.getByRole("button", { name: "关闭麦克风", exact: true }),
    ).toBeEnabled();
    await capture(member);
    await capture(page);
    await startShare(member);
    await expect(page.locator(".video-label")).toContainText(
      "被管理成员正在共享",
    );
    await expect
      .poll(() =>
        page.locator("video").evaluate((v: HTMLVideoElement) => v.videoWidth),
      )
      .toBeGreaterThan(0);
    await menu(page, "被管理成员", "关闭麦克风");
    await expect(
      member.getByRole("button", { name: "开启麦克风", exact: true }),
    ).toBeEnabled();
    await expect(
      member.getByText("房主已关闭你的麦克风", { exact: true }),
    ).toBeVisible();
    await expect(page.locator(".video-label")).toContainText("含共享声音");
    await member
      .getByRole("button", { name: "开启麦克风", exact: true })
      .click();
    await expect(
      member.getByRole("button", { name: "关闭麦克风", exact: true }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: "被管理成员的成员操作", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "停止共享", exact: true }).hover();
    await page.screenshot({ path: ".local/room-moderation/sharer-menu.png" });
    await page.getByRole("menuitem", { name: "停止共享", exact: true }).click();
    await expect(
      member.getByText("房主已停止你的共享", { exact: true }),
    ).toBeVisible();
    await expect(member.locator(".sharing-banner")).toHaveCount(0);
    await expect(page.locator(".video-label")).toHaveCount(0);
    await expect
      .poll(() =>
        member.evaluate(() =>
          (
            window as unknown as { captureTracks: MediaStreamTrack[] }
          ).captureTracks.every((t) => t.readyState === "ended"),
        ),
      )
      .toBe(true);
    await startShare(member);
    await page.getByRole("button", { name: "抢占共享", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "抢占共享", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("checkbox", { name: "共享声音", exact: true })
      .check();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "选择并共享", exact: true })
      .click();
    await expect(member.locator(".video-label")).toContainText(
      "管理房主正在共享",
    );
    await expect(member.locator(".sharing-banner")).toHaveCount(0);
    await expect(
      member.getByRole("button", { name: "共享屏幕", exact: true }),
    ).toBeDisabled();
    await page
      .getByRole("button", { name: "被管理成员的成员操作", exact: true })
      .click();
    await expect(
      page.getByRole("menuitem", { name: "转移房主", exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: ".local/room-moderation/member-menu.png" });
    await page.getByRole("menuitem", { name: "转移房主", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "取消", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "房间设置", exact: true }),
    ).toBeVisible();
    await menu(page, "被管理成员", "转移房主");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "确认转移", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "房间设置", exact: true }),
    ).toHaveCount(0);
    await expect(
      member.getByRole("button", { name: "房间设置", exact: true }),
    ).toBeVisible();
    await expect(
      member.getByRole("button", { name: "抢占共享", exact: true }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: "被管理成员的成员操作", exact: true })
      .click();
    await expect(
      page.getByRole("menuitem", { name: "关闭麦克风", exact: true }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
    await menu(member, "管理房主", "关闭麦克风");
    await expect(
      page.getByRole("button", { name: "开启麦克风", exact: true }),
    ).toBeEnabled();
    await menu(member, "管理房主", "停止共享");
    await expect(page.locator(".sharing-banner")).toHaveCount(0);
    await expect(member.locator(".members-list .member")).toHaveCount(2);
    await member.screenshot({ path: ".local/room-moderation/new-owner.png" });
  } finally {
    await leave(member);
    await leave(page);
    await other.close();
  }
});

test("owner mute cancels a member's pending microphone grant without auto-opening it later", async ({
  page,
  context,
  browser,
}) => {
  await context.grantPermissions(["microphone"]);
  const other = await browser.newContext({ permissions: ["microphone"] });
  const member = await other.newPage();
  try {
    const code = await create(page);
    await member.goto("/");
    await registerTestAccount(member, "等待麦克风成员");
    await member.evaluate(() => {
      const original = navigator.mediaDevices.getUserMedia.bind(
        navigator.mediaDevices,
      );
      navigator.mediaDevices.getUserMedia = async (constraints) => {
        if (constraints?.audio) {
          Object.assign(window, { microphoneRequested: true });
          await new Promise<void>((resolve) =>
            Object.assign(window, { grantMicrophone: resolve }),
          );
        }
        return original(constraints);
      };
    });
    await member.getByRole("button", { name: "加入房间", exact: true }).click();
    await member.getByLabel("房间号或邀请链接").fill(code);
    await member.getByRole("button", { name: "进入房间", exact: true }).click();
    await expect
      .poll(() =>
        member.evaluate(() =>
          Boolean(
            (window as unknown as { microphoneRequested?: boolean })
              .microphoneRequested,
          ),
        ),
      )
      .toBe(true);
    await expect(page.locator(".members-list .member")).toHaveCount(2);
    await menu(page, "等待麦克风成员", "关闭麦克风");
    await expect(
      member.getByText("房主已关闭你的麦克风", { exact: true }),
    ).toBeVisible();
    await member.evaluate(() =>
      (window as unknown as { grantMicrophone(): void }).grantMicrophone(),
    );
    await expect(member.getByRole("dialog")).toHaveCount(0);
    await expect(member.locator(".connection")).toContainText("已连接");
    await expect(
      member.getByRole("button", { name: "开启麦克风", exact: true }),
    ).toBeEnabled();
    // Allow the SDK's pending track publication to settle, then verify the remote state.
    await expect(
      page.locator(".member").filter({ hasText: "等待麦克风成员" }),
    ).toContainText("麦克风已关闭");
    await expect(
      member.getByRole("button", { name: "开启麦克风", exact: true }),
    ).toBeEnabled();
  } finally {
    await member.evaluate(() =>
      (
        window as unknown as { grantMicrophone?: () => void }
      ).grantMicrophone?.(),
    );
    await leave(member);
    await leave(page);
    await other.close();
  }
});
