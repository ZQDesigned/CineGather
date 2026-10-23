import { registerTestAccount } from "./helpers/account";
import { test, expect, type Page } from "@playwright/test";

async function guest(page: Page, name: string) {
  await page.goto("/");
  await registerTestAccount(page, name);
  await expect(
    page.getByRole("heading", { name: `晚上好，${name}` }),
  ).toBeVisible();
}
async function create(page: Page) {
  await guest(page, "Chrome 房主");
  await page.getByRole("button", { name: "创建私人房间", exact: true }).click();
  await page.getByLabel("房间名称").fill("Chrome 共享界面验证");
  await page.getByRole("button", { name: "创建并进入" }).click();
  await expect(
    page.getByRole("button", { name: "选择屏幕开始共享", exact: true }),
  ).toBeEnabled();
}
async function leave(page: Page) {
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const exit = page.getByRole("button", { name: "离开房间", exact: true });
  if (await exit.count()) await exit.click();
  // The room UI disappears at the start of leaving. Wait for the server leave
  // to finish before reloading, otherwise navigation can cancel that request.
  await expect(page.locator(".connection")).toContainText("未连接房间");
}

test("production Chrome uses same-origin API, shared room UI, browser invites, voice, chat, and video publication", async ({
  page,
  browser,
  context,
}) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/"))
      requests.push(new URL(request.url()).origin);
  });
  await context.grantPermissions(["microphone"]);
  await create(page);
  await expect(
    page.getByRole("button", { name: "关闭麦克风", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "邀请朋友", exact: true }).click();
  const invite = await page.getByLabel("房间邀请").inputValue();
  expect(invite).toMatch(/^http:\/\/127\.0\.0\.1:5180\/\?room=.*#invite=/);
  await page.getByRole("button", { name: "关闭对话框", exact: true }).click();
  const other = await browser.newContext({ permissions: ["microphone"] });
  const viewer = await other.newPage();
  try {
    await viewer.goto(invite);
    expect(viewer.url()).toBe("http://127.0.0.1:5180/");
    await registerTestAccount(viewer, "Chrome 观众");
    await expect(
      viewer.getByRole("dialog", { name: "加入朋友的房间" }),
    ).toBeVisible();
    await viewer.getByRole("button", { name: "进入房间", exact: true }).click();
    await expect(page.locator(".members-list .member")).toHaveCount(2);
    await expect(
      viewer.getByRole("button", { name: "关闭麦克风", exact: true }),
    ).toBeEnabled();
    await viewer.getByRole("tab", { name: "聊天", exact: true }).click();
    await page.getByRole("tab", { name: "聊天", exact: true }).click();
    await viewer.getByLabel("聊天消息").fill("Chrome 与桌面共用这个聊天组件");
    await viewer.getByRole("button", { name: "发送消息", exact: true }).click();
    await expect(page.locator(".chat-message")).toContainText(
      "共用这个聊天组件",
    );
    for (const viewport of [
      { width: 980, height: 680 },
      { width: 1440, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollHeight <= innerHeight &&
            document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await expect(page.locator(".chat-compose")).toBeInViewport({ ratio: 1 });
    }
    await page.evaluate(() => {
      const original = navigator.mediaDevices.getDisplayMedia.bind(
        navigator.mediaDevices,
      );
      const probe = { active: false, tracks: [] as MediaStreamTrack[] };
      Object.assign(window, { browserCaptureProbe: probe });
      navigator.mediaDevices.getDisplayMedia = async (options) => {
        probe.active = navigator.userActivation.isActive;
        const stream = await original(options);
        probe.tracks.push(...stream.getTracks());
        for (const track of stream.getAudioTracks()) {
          track.stop();
          stream.removeTrack(track);
        }
        return stream;
      };
    });
    await page
      .getByRole("button", { name: "选择屏幕开始共享", exact: true })
      .click();
    await expect(
      page.getByText("在 Chrome 中选择屏幕、窗口或标签页", { exact: true }),
    ).toBeVisible();
    await page.getByRole("checkbox", { name: "共享声音", exact: true }).check();
    await page.getByRole("button", { name: "选择并共享", exact: true }).click();
    await expect(page.locator(".sharing-banner")).toBeVisible();
    await expect(
      page.locator(".ant-notification-notice-warning"),
    ).toContainText("共享声音不可用");
    await expect(page.locator(".connection")).toContainText("已连接");
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { browserCaptureProbe: { active: boolean } })
            .browserCaptureProbe.active,
      ),
    ).toBe(true);
    await expect(viewer.locator(".video-label")).toContainText(
      "Chrome 房主正在共享",
    );
    await expect
      .poll(() =>
        viewer.locator("video").evaluate((v: HTMLVideoElement) => v.videoWidth),
      )
      .toBeGreaterThan(0);
    await page.screenshot({ path: ".local/chrome-support/chrome-room.png" });
    await page
      .locator(".sharing-banner")
      .getByRole("button", { name: "停止共享", exact: true })
      .click();
    await expect(viewer.locator(".video-label")).toHaveCount(0);
    expect(
      await page.evaluate(() =>
        (
          window as unknown as {
            browserCaptureProbe: { tracks: MediaStreamTrack[] };
          }
        ).browserCaptureProbe.tracks.every((t) => t.readyState === "ended"),
      ),
    ).toBe(true);
    expect(requests.length).toBeGreaterThan(3);
    expect(new Set(requests)).toEqual(new Set(["http://127.0.0.1:5180"]));
    await leave(viewer);
  } finally {
    await other.close();
    await leave(page);
  }
});

test("Chrome settings have page-only shortcuts, no tray controls, and mute works only outside text entry", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["microphone"]);
  await create(page);
  try {
    await page
      .getByRole("menuitem", { name: "设置与设备", exact: true })
      .click();
    await page.getByRole("tab", { name: "共享与快捷键", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "页面内按住说话", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText("关闭窗口后保留在托盘", { exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "页面内麦克风静音", exact: true })
      .click();
    await page.keyboard.press("Control+Shift+K");
    await expect(
      page.getByRole("button", { name: "页面内麦克风静音", exact: true }),
    ).toContainText("K");
    await page.getByRole("button", { name: "保存设置", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.locator(".stage").click();
    await page.keyboard.press("Control+Shift+K");
    await expect(
      page.getByRole("button", { name: "开启麦克风", exact: true }),
    ).toBeEnabled();
    await page.getByRole("tab", { name: "聊天", exact: true }).click();
    await page.getByLabel("聊天消息").focus();
    await page.keyboard.press("Control+Shift+K");
    await expect(
      page.getByRole("button", { name: "开启麦克风", exact: true }),
    ).toBeEnabled();
    await page.locator(".stage").click();
    await page.keyboard.press("Control+Shift+K");
    await expect(
      page.getByRole("button", { name: "关闭麦克风", exact: true }),
    ).toBeEnabled();
  } finally {
    await leave(page);
  }
});

test("Chrome ignores saved push-to-talk and keeps free-mic or manual mute across keys and settings saves", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["microphone"]);
  await page.addInitScript(() => {
    if (!localStorage.getItem("cinegather.settings"))
      localStorage.setItem(
        "cinegather.settings",
        JSON.stringify({
          minimizeToTray: true,
          pushToTalk: true,
          quality: "cinema",
          pttShortcut: "Control+Alt+K",
          muteShortcut: "CommandOrControl+Shift+M",
          inputDevice: "",
          outputDevice: "",
        }),
      );
  });
  await create(page);
  try {
    const mic = (muted: boolean) =>
      page.getByRole("button", {
        name: muted ? "开启麦克风" : "关闭麦克风",
        exact: true,
      });
    await expect(mic(false)).toBeEnabled();
    expect(
      await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("cinegather.settings")!).pushToTalk,
      ),
    ).toBe(false);
    for (const muted of [false, true]) {
      if (muted) await mic(false).click();
      await page.locator(".stage").click({ position: { x: 8, y: 8 } });
      for (const key of ["Space", "Control+Alt+K"]) {
        for (const part of key.split("+")) await page.keyboard.down(part);
        const unchanged = await page.evaluate(
          (label) =>
            new Promise<boolean>((resolve) => {
              let frames = 0;
              const sample = () => {
                if (!document.querySelector(`[aria-label="${label}"]`))
                  resolve(false);
                else if (++frames >= 20) resolve(true);
                else requestAnimationFrame(sample);
              };
              sample();
            }),
          muted ? "开启麦克风" : "关闭麦克风",
        );
        for (const part of key.split("+").reverse())
          await page.keyboard.up(part);
        expect(unchanged).toBe(true);
        await expect(mic(muted)).toBeEnabled();
      }
    }
    await page
      .getByRole("menuitem", { name: "设置与设备", exact: true })
      .click();
    await page.getByRole("tab", { name: "共享与快捷键", exact: true }).click();
    await expect(
      page.getByRole("checkbox", { name: "按键说话", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByRole("button", { name: /按住说话/ })).toHaveCount(0);
    await page.getByRole("button", { name: "保存设置", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(mic(true)).toBeEnabled();
    expect(
      await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("cinegather.settings")!).pushToTalk,
      ),
    ).toBe(false);
    await leave(page);
    await page.reload();
    await expect(
      page.locator(".room-card").filter({ hasText: "Chrome 共享界面验证" }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "创建私人房间", exact: true })
      .click();
    await page.getByLabel("房间名称").fill("Chrome 自由麦重新入房");
    await page.getByRole("button", { name: "创建并进入", exact: true }).click();
    await expect(mic(false)).toBeEnabled();
    await expect(page.getByText("按住空格说话", { exact: true })).toHaveCount(
      0,
    );
  } finally {
    await leave(page);
  }
});

test("canceling Chrome selection or a late browser grant never publishes or leaks a share lease", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["microphone"]);
  await create(page);
  try {
    await page.evaluate(() => {
      navigator.mediaDevices.getDisplayMedia = () =>
        Promise.reject(new DOMException("Dismissed", "NotAllowedError"));
    });
    await page
      .getByRole("button", { name: "选择屏幕开始共享", exact: true })
      .click();
    await page.getByRole("button", { name: "选择并共享", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator(".sharing-banner")).toHaveCount(0);
    await page.evaluate(() => {
      Object.assign(window, { finishCapture: undefined });
      navigator.mediaDevices.getDisplayMedia = () =>
        new Promise((resolve) =>
          Object.assign(window, { finishCapture: resolve }),
        );
    });
    await page
      .getByRole("button", { name: "选择屏幕开始共享", exact: true })
      .click();
    await page.getByRole("button", { name: "选择并共享", exact: true }).click();
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      const stream = canvas.captureStream(1);
      Object.assign(window, { lateCapture: stream });
      (
        window as unknown as { finishCapture(s: MediaStream): void }
      ).finishCapture(stream);
    });
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as unknown as { lateCapture: MediaStream }).lateCapture
            .getTracks()
            .every((t) => t.readyState === "ended"),
        ),
      )
      .toBe(true);
    await expect(page.locator(".sharing-banner")).toHaveCount(0);
    // The next attempt can acquire again, proving cleanup released authority.
    await page
      .getByRole("button", { name: "选择屏幕开始共享", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "选择并共享", exact: true }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "取消", exact: true }).click();
  } finally {
    await leave(page);
  }
});

test("unsupported browser media APIs keep settings and basic chat usable", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "mediaDevices", {
      value: undefined,
      configurable: true,
    }),
  );
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await create(page);
  try {
    await page
      .getByRole("menuitem", { name: "设置与设备", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "测试麦克风", exact: true }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "关闭对话框", exact: true }).click();
    await page
      .getByRole("button", { name: "选择屏幕开始共享", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "选择并共享", exact: true }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await page.getByRole("tab", { name: "聊天", exact: true }).click();
    await page.getByLabel("聊天消息").fill("设备不可用时仍可聊天");
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    await expect(page.locator(".chat-message")).toContainText("仍可聊天");
    await page.getByRole("menuitem", { name: "连接诊断", exact: true }).click();
    await expect(page.getByText("可以连接", { exact: true })).toBeVisible();
    const downloaded = page.waitForEvent("download");
    await page.getByRole("button", { name: "导出诊断", exact: true }).click();
    const download = await downloaded;
    const { readFile } = await import("node:fs/promises");
    const report = JSON.parse(await readFile((await download.path())!, "utf8"));
    expect(report.browser.capabilities).toMatchObject({
      desktop: false,
      microphone: false,
      sourcePicker: false,
    });
    expect(report.state).toBe("connected");
    await page.getByRole("button", { name: "关闭对话框", exact: true }).click();
    expect(errors).toEqual([]);
  } finally {
    await leave(page);
  }
});
