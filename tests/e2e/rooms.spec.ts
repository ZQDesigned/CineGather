import { registerTestAccount } from "./helpers/account";
import { test, expect, type Page } from "@playwright/test";
import { RoomServiceClient, TrackSource } from "livekit-server-sdk";
import pg from "pg";
import { defaultSettings } from "../../apps/desktop/src/shared/settings";

// These renderer tests exercise desktop PTT through a desktop bridge; browser
// sessions intentionally support free-mic only.
async function desktopTalkBridge(page: Page) {
  await page.addInitScript((defaults) => {
    Object.assign(window, {
      desktop: {
        platform: "darwin",
        loadSettings: async () =>
          JSON.parse(localStorage.getItem("cinegather.settings") ?? "null") ??
          defaults,
        saveSettings: async (settings: typeof defaults) =>
          localStorage.setItem("cinegather.settings", JSON.stringify(settings)),
        takeInvitation: async () => undefined,
        onAction: () => () => {},
        setSharing: async () => {},
        cancelCapture: async () => {},
      },
    });
  }, defaultSettings);
}
async function guest(page: Page, name: string) {
  await page.goto("/");
  await registerTestAccount(page, name);
  await expect(
    page.getByRole("heading", { name: `晚上好，${name}` }),
  ).toBeVisible();
}
test("two independent clients join a real LiveKit room, synchronize microphone and persist chat", async ({
  page,
  browser,
}) => {
  await guest(page, "小映");
  await page.getByRole("button", { name: "创建私人房间", exact: true }).click();
  await page.getByLabel("房间名称").fill("周末放映室");
  await page.getByRole("button", { name: "创建并进入" }).click();
  await expect(page.getByRole("heading", { name: "周末放映室" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "关闭麦克风", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "邀请朋友" }).click();
  const invite = await page.getByLabel("房间邀请").inputValue();
  await page.getByRole("button", { name: "关闭对话框" }).click();
  const context = await browser.newContext({ permissions: ["microphone"] });
  const friend = await context.newPage();
  try {
    await guest(friend, "小聚");
    await friend.getByRole("button", { name: "加入房间", exact: true }).click();
    await friend.getByLabel("房间号或邀请链接").fill(invite);
    await friend.getByRole("button", { name: "进入房间", exact: true }).click();
    await expect(
      friend.getByRole("heading", { name: "周末放映室" }),
    ).toBeVisible();
    await expect(page.locator(".members-list .member")).toHaveCount(2);
    await expect(friend.locator(".members-list .member")).toHaveCount(2);
    await friend
      .getByRole("button", { name: "关闭麦克风", exact: true })
      .click();
    await expect(
      page.locator(".member").filter({ hasText: "小聚" }),
    ).toContainText("麦克风已关闭");
    const memberVolume = page.getByRole("slider", {
      name: "小聚的音量",
      exact: true,
    });
    await expect(page.locator(".members-list").getByRole("slider")).toHaveCount(
      0,
    );
    await page.setViewportSize({ width: 980, height: 680 });
    await page
      .getByRole("button", { name: "小聚的成员操作", exact: true })
      .click();
    await expect(memberVolume).toBeVisible();
    await expect(memberVolume).not.toBeFocused();
    await expect(page.locator(".ant-slider-tooltip:visible")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(memberVolume).toHaveCount(0);
    await page
      .locator(".member")
      .filter({ hasText: "小聚" })
      .click({ button: "right" });
    await expect(memberVolume).toBeVisible();
    await expect(memberVolume).not.toBeFocused();
    await expect(page.locator(".ant-slider-tooltip:visible")).toHaveCount(0);
    await memberVolume.hover();
    await expect(page.locator(".ant-slider-tooltip:visible")).toHaveText(
      "100%",
    );
    await memberVolume.focus();
    await memberVolume.press("Home");
    await memberVolume.press("ArrowRight");
    await expect(memberVolume).toHaveAttribute("aria-valuenow", "1");
    const rail = await page
      .locator(".member-context-popup .ant-slider")
      .boundingBox();
    const handle = await memberVolume.boundingBox();
    expect(rail && handle).toBeTruthy();
    await page.mouse.move(
      handle!.x + handle!.width / 2,
      handle!.y + handle!.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      rail!.x + rail!.width * 0.75,
      rail!.y + rail!.height / 2,
    );
    await page.mouse.up();
    expect(
      Number(await memberVolume.getAttribute("aria-valuenow")),
    ).toBeGreaterThan(60);
    await expect(page.locator(".member-context-popup")).toBeVisible();
    await memberVolume.press("Home");
    await memberVolume.press("ArrowRight");
    await page.getByRole("menuitem", { name: "移出房间", exact: true }).hover();
    const popup = await page.locator(".member-context-popup").boundingBox();

    expect(
      popup &&
        popup.x >= 0 &&
        popup.y >= 0 &&
        popup.x + popup.width <= 980 &&
        popup.y + popup.height <= 680,
    ).toBeTruthy();
    await page.screenshot({ path: ".local/member-context/menu-min.png" });
    await expect(
      page.getByRole("menuitem", { name: "移出房间", exact: true }),
    ).toBeVisible();
    await memberVolume.press("Escape");
    await expect(memberVolume).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "小聚的成员操作", exact: true }),
    ).toBeFocused();
    await page.getByRole("tab", { name: "聊天", exact: true }).click();
    await friend.getByRole("tab", { name: "聊天", exact: true }).click();
    await friend.getByLabel("聊天消息").fill("今晚一起看！");
    await friend.getByRole("button", { name: "发送消息" }).click();
    await expect(page.locator(".chat-message")).toContainText("今晚一起看！");
    await page.screenshot({ path: ".local/room-ui.png", fullPage: true });
    await page.getByRole("tab", { name: /成员/ }).click();
    await page
      .getByRole("button", { name: "小聚的成员操作", exact: true })
      .press("Enter");
    await expect(memberVolume).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("menuitem", { name: "添加好友", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(memberVolume).toBeFocused();
    await expect(memberVolume).toHaveAttribute("aria-valuenow", "1");
    await page.keyboard.press("Escape");
    await friend.getByRole("button", { name: "离开房间" }).click();
    await page.getByRole("tab", { name: /成员/ }).click();
    await expect(page.locator(".members-list .member")).toHaveCount(1);
    await expect(page.locator("audio[data-cinegather-audio]")).toHaveCount(0);
  } finally {
    await context.close();
    await page.getByRole("button", { name: "离开房间" }).click();
  }
});
test("settings device tests release captured microphone when the dialog closes", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    const tracks: MediaStreamTrack[] = [];
    Object.assign(window, { observedCaptureTracks: tracks });
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await original(constraints);
      tracks.push(...stream.getTracks());
      return stream;
    };
  });
  await page.goto("/");
  await page.getByRole("menuitem", { name: "设置与设备", exact: true }).click();
  await page.getByRole("button", { name: "测试麦克风", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "停止测试", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "关闭对话框" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(
    await page.evaluate(() => {
      const tracks = (
        window as unknown as { observedCaptureTracks: MediaStreamTrack[] }
      ).observedCaptureTracks;
      return tracks.length > 0 && tracks.every((t) => t.readyState === "ended");
    }),
  ).toBe(true);
});
test("a real screen publisher holds the only server lease and stopping removes its media authority", async ({
  page,
  browser,
  request,
}) => {
  await guest(page, "共享者");
  await page.getByRole("button", { name: "创建私人房间", exact: true }).click();
  await page.getByLabel("房间名称").fill("共享权限测试");
  await page.getByRole("button", { name: "创建并进入" }).click();
  await expect(
    page.getByRole("heading", { name: "共享权限测试" }),
  ).toBeVisible();
  const ownerToken = await page.evaluate(() =>
    localStorage.getItem("cinegather.session"),
  );
  await page.getByRole("button", { name: "邀请朋友" }).click();
  const invite = new URL(await page.getByLabel("房间邀请").inputValue());
  const roomId = invite.searchParams.get("room")!;
  await page.getByRole("button", { name: "关闭对话框" }).click();
  const context = await browser.newContext({ permissions: ["microphone"] });
  const viewer = await context.newPage();
  try {
    await guest(viewer, "观看者");
    await viewer.getByRole("button", { name: "加入房间", exact: true }).click();
    await viewer.getByLabel("房间号或邀请链接").fill(invite.toString());
    await viewer.getByRole("button", { name: "进入房间", exact: true }).click();
    await expect(
      viewer.getByRole("heading", { name: "共享权限测试" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "选择屏幕开始共享" }).click();
    await page.getByRole("button", { name: "选择并共享", exact: true }).click();
    await expect(page.locator(".sharing-banner")).toBeVisible({
      timeout: 20000,
    });
    await expect(viewer.locator(".video-label")).toContainText(
      "共享者正在共享",
    );
    await expect
      .poll(() =>
        viewer
          .locator("video")
          .evaluate((video) => (video as HTMLVideoElement).videoWidth),
      )
      .toBeGreaterThan(0);
    const viewerToken = await viewer.evaluate(() =>
      localStorage.getItem("cinegather.session"),
    );
    const denied = await request.post(
      `http://127.0.0.1:14310/api/v1/rooms/${roomId}/share-lease`,
      { headers: { Authorization: `Bearer ${viewerToken}` } },
    );
    expect(denied.status()).toBe(409);
    expect((await denied.json()).code).toBe("SHARE_BUSY");
    const leaseResponse = await request.post(
      `http://127.0.0.1:14310/api/v1/rooms/${roomId}/share-lease`,
      { headers: { Authorization: `Bearer ${ownerToken}` } },
    );
    const lease = await leaseResponse.json();
    expect(leaseResponse.status()).toBe(201);
    await viewer.getByRole("button", { name: "暂停观看", exact: true }).click();
    await page
      .locator(".sharing-banner")
      .getByRole("button", { name: "停止共享" })
      .click();
    await expect(viewer.locator(".video-label")).toHaveCount(0);
    await page.getByRole("button", { name: "选择屏幕开始共享" }).click();
    await page.getByRole("button", { name: "选择并共享", exact: true }).click();
    await expect(page.locator(".sharing-banner")).toBeVisible();
    await expect(viewer.locator(".video-label")).toContainText(
      "共享者正在共享",
    );
    const stayedPaused = await viewer.locator("video").evaluate(
      (video) =>
        new Promise<boolean>((resolve) => {
          let frames = 0;
          let resumed = false;
          const sample = () => {
            resumed ||= (video as HTMLVideoElement).srcObject !== null;
            if (++frames >= 90) resolve(!resumed);
            else requestAnimationFrame(sample);
          };
          sample();
        }),
    );
    expect(stayedPaused).toBe(true);
    await page
      .locator(".sharing-banner")
      .getByRole("button", { name: "停止共享" })
      .click();
    await expect(
      page.getByRole("button", { name: "共享屏幕", exact: true }),
    ).toBeEnabled();
    const next = await request.post(
      `http://127.0.0.1:14310/api/v1/rooms/${roomId}/share-lease`,
      { headers: { Authorization: `Bearer ${viewerToken}` } },
    );
    const newLease = await next.json();
    expect(next.status()).toBe(201);
    expect(newLease.revision).toBeGreaterThan(lease.revision);
    const stale = await request.delete(
      `http://127.0.0.1:14310/api/v1/rooms/${roomId}/share-lease`,
      {
        headers: { Authorization: `Bearer ${ownerToken}` },
        data: { leaseId: lease.leaseId, revision: lease.revision },
      },
    );
    expect(stale.status()).toBe(409);
    const livekit = new RoomServiceClient(
      process.env.LIVEKIT_INTERNAL_URL!,
      process.env.LIVEKIT_API_KEY!,
      process.env.LIVEKIT_API_SECRET!,
    );
    const viewerIdentity = await (
      await request.get("http://127.0.0.1:14310/api/v1/me", {
        headers: { Authorization: `Bearer ${viewerToken}` },
      })
    ).json();
    expect(
      (await livekit.getParticipant(roomId, viewerIdentity.id)).permission
        ?.canPublishSources,
    ).toContain(TrackSource.SCREEN_SHARE);
    await viewer.getByRole("button", { name: "选择屏幕开始共享" }).click();
    await viewer
      .getByRole("button", { name: "选择并共享", exact: true })
      .click();
    await expect(viewer.locator(".sharing-banner")).toBeVisible();
    await expect(page.locator(".video-label")).toContainText("观看者正在共享");
    const database = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
    });
    try {
      await database.query(
        `UPDATE share_leases SET expires_at = now() - interval '1 second' WHERE room_id = $1`,
        [roomId],
      );
    } finally {
      await database.end();
    }
    await expect
      .poll(
        async () =>
          (
            await livekit.getParticipant(roomId, viewerIdentity.id)
          ).permission?.canPublishSources.includes(TrackSource.SCREEN_SHARE),
        { timeout: 15000 },
      )
      .toBe(false);
    await expect(page.locator(".video-label")).toHaveCount(0);
    const expiredRenewal = await request.post(
      `http://127.0.0.1:14310/api/v1/rooms/${roomId}/share-lease/renew`,
      {
        headers: { Authorization: `Bearer ${viewerToken}` },
        data: { leaseId: newLease.leaseId, revision: newLease.revision },
      },
    );
    expect(expiredRenewal.status()).toBe(409);

    await viewer.getByRole("button", { name: "离开房间" }).click();
  } finally {
    await context.close();
    await page.getByRole("button", { name: "离开房间" }).click();
  }
});
test("revoking an active account session disconnects its existing media identity", async ({
  page,
  request,
}) => {
  await guest(page, "撤销验证");
  await page.getByRole("button", { name: "创建私人房间", exact: true }).click();
  await page.getByLabel("房间名称").fill("会话撤销测试");
  await page.getByRole("button", { name: "创建并进入" }).click();
  await page.getByRole("button", { name: "关闭麦克风", exact: true }).waitFor();
  const token = await page.evaluate(() =>
    localStorage.getItem("cinegather.session"),
  );
  const response = await request.get("http://127.0.0.1:14310/api/v1/rooms", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const roomId = (await response.json()).items[0].id;
  const livekit = new RoomServiceClient(
    process.env.LIVEKIT_INTERNAL_URL!,
    process.env.LIVEKIT_API_KEY!,
    process.env.LIVEKIT_API_SECRET!,
  );
  expect((await livekit.listParticipants(roomId)).length).toBe(1);
  let releaseCleanup!: () => void;
  const cleanup = new Promise<void>((resolve) => {
    releaseCleanup = resolve;
  });
  // Reproduce a removal cleanup request dispatched after credentials are cleared.
  await page.route(`**/api/v1/rooms/${roomId}`, async (route) => {
    await cleanup;
    const headers = { ...route.request().headers() };
    delete headers.authorization;
    await route.continue({ headers }).catch(() => {});
  });
  const revoked = await request.delete(
    "http://127.0.0.1:14310/api/v1/session",
    { headers: { Authorization: `Bearer ${token}` } },
  );
  expect(revoked.status()).toBe(200);
  await expect
    .poll(
      async () =>
        (
          await livekit
            .listParticipants(roomId)
            .catch((error: { code?: string }) => {
              if (error.code === "not_found") return [];
              throw error;
            })
        ).length,
      {
        timeout: 12000,
      },
    )
    .toBe(0);
  await expect(page.getByLabel("用户名", { exact: true })).toBeVisible();
  releaseCleanup();
  await page.waitForResponse(
    (response) =>
      response.url().endsWith(`/rooms/${roomId}`) && response.status() === 401,
  );
  await expect(
    page.locator(".ant-notification").getByRole("alert"),
  ).toContainText("登录已失效");
  await expect(
    page.locator(".ant-notification").getByRole("alert"),
  ).not.toContainText("房主移出");
});
test("an SFU restart produces an honest reconnecting state and restores the microphone", async ({
  page,
}) => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  await guest(page, "重连验证");
  await page.getByRole("button", { name: "创建私人房间", exact: true }).click();
  await page.getByLabel("房间名称").fill("重连测试");
  await page.getByRole("button", { name: "创建并进入" }).click();
  await page.getByRole("button", { name: "关闭麦克风", exact: true }).waitFor();
  await page.locator(".connection").evaluate((element) => {
    const changes: string[] = [element.textContent ?? ""];
    new MutationObserver(() => changes.push(element.textContent ?? "")).observe(
      element,
      { subtree: true, childList: true, characterData: true },
    );
    Object.assign(window, { reconnectStates: changes });
  });
  await promisify(execFile)("docker", [
    "compose",
    "--env-file",
    ".env",
    "-f",
    "infra/compose/dev.yml",
    "restart",
    "--timeout",
    "1",
    "livekit",
  ]);
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          (
            window as unknown as { reconnectStates: string[] }
          ).reconnectStates.some((s) => /重新连接|断开/.test(s)),
        ),
      { timeout: 15000 },
    )
    .toBe(true);
  await expect(page.locator(".connection")).toHaveText("已连接", {
    timeout: 30000,
  });
  await expect(
    page.getByRole("button", { name: "关闭麦克风", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".members-list .member")).toHaveCount(1);
  await page.getByRole("button", { name: "离开房间", exact: true }).click();
});

test("double-clicking the fullscreen control performs exactly one operation per click", async ({
  page,
}) => {
  await guest(page, "全屏回归");
  await page.getByRole("button", { name: "创建私人房间", exact: true }).click();
  await page.getByLabel("房间名称").fill("全屏控制测试");
  await page.getByRole("button", { name: "创建并进入" }).click();
  await expect(
    page.getByRole("heading", { name: "全屏控制测试" }),
  ).toBeVisible();
  await page.evaluate(() => {
    const observed = { operations: 0 };
    Object.assign(window, { fullscreenProbe: observed });
    // Observe the native fullscreen boundary without resizing between the two
    // pointer events; the product handlers and event propagation remain real.
    Element.prototype.requestFullscreen = async function () {
      observed.operations++;
    };
    Document.prototype.exitFullscreen = async function () {
      observed.operations++;
    };
  });
  try {
    await page
      .getByRole("button", { name: "全屏画面", exact: true })
      .dblclick();
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { fullscreenProbe: { operations: number } })
            .fullscreenProbe.operations,
      ),
    ).toBe(2);
  } finally {
    await page.evaluate(async () => {
      if (document.fullscreenElement)
        await document.exitFullscreen().catch(() => {});
    });
    await page.getByRole("button", { name: "离开房间", exact: true }).click();
  }
});

test("closing settings while microphone permission is pending releases the late capture", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    const probe = {
      tracks: [] as MediaStreamTrack[],
      release: undefined as (() => void) | undefined,
    };
    Object.assign(window, { delayedDeviceProbe: probe });
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await original(constraints);
      probe.tracks.push(...stream.getTracks());
      await new Promise<void>((resolve) => {
        probe.release = resolve;
      });
      return stream;
    };
  });
  await page.goto("/");
  await page.getByRole("menuitem", { name: "设置与设备", exact: true }).click();
  await page.getByRole("button", { name: "测试麦克风", exact: true }).click();
  const ended = () =>
    page.evaluate(() => {
      const probe = (
        window as unknown as {
          delayedDeviceProbe: { tracks: MediaStreamTrack[] };
        }
      ).delayedDeviceProbe;
      return (
        probe.tracks.length > 0 &&
        probe.tracks.every((track) => track.readyState === "ended")
      );
    });
  await expect
    .poll(() =>
      page.evaluate(() =>
        Boolean(
          (
            window as unknown as {
              delayedDeviceProbe: { release?: () => void };
            }
          ).delayedDeviceProbe.release,
        ),
      ),
    )
    .toBe(true);
  await page.getByRole("button", { name: "关闭对话框" }).click();
  await page.evaluate(() =>
    (
      window as unknown as { delayedDeviceProbe: { release: () => void } }
    ).delayedDeviceProbe.release(),
  );
  try {
    await expect.poll(ended).toBe(true);
  } finally {
    await page.evaluate(() =>
      (
        window as unknown as {
          delayedDeviceProbe: { tracks: MediaStreamTrack[] };
        }
      ).delayedDeviceProbe.tracks.forEach((track) => track.stop()),
    );
  }
});

test("a removed output device does not leave the speaker test audio context open", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const contexts: AudioContext[] = [];
    Object.assign(window, { speakerTestContexts: contexts });
    const Original = window.AudioContext;
    window.AudioContext = class extends Original {
      constructor(options?: AudioContextOptions) {
        super(options);
        contexts.push(this);
      }
    };
    navigator.mediaDevices.enumerateDevices = async () => [
      {
        deviceId: "removed-speaker",
        groupId: "test-only",
        kind: "audiooutput" as const,
        label: "已拔出的测试扬声器",
        toJSON() {
          return {};
        },
      },
    ];
    HTMLMediaElement.prototype.setSinkId = async () => {
      throw new DOMException(
        "The selected speaker was removed",
        "NotFoundError",
      );
    };
  });
  await page.goto("/");
  await page.getByRole("menuitem", { name: "设置与设备", exact: true }).click();
  await page
    .getByRole("combobox", { name: "扬声器 / 耳机", exact: true })
    .click();
  await page
    .getByRole("option", { name: "已拔出的测试扬声器", exact: true })
    .click();
  await page.getByRole("button", { name: "播放测试音", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const contexts = (
          window as unknown as { speakerTestContexts: AudioContext[] }
        ).speakerTestContexts;
        return (
          contexts.length > 0 &&
          contexts.every((context) => context.state === "closed")
        );
      }),
    )
    .toBe(true);
});

test("a rejected join displays an actionable notification above the active dialog", async ({
  page,
}) => {
  await guest(page, "加入失败提示");
  await page.getByRole("button", { name: "加入房间", exact: true }).click();
  await page
    .getByLabel("房间号或邀请链接")
    .fill("00000000-0000-4000-8000-000000000000");
  await page.getByRole("button", { name: "进入房间", exact: true }).click();
  await expect(
    page.locator(".ant-notification").getByRole("alert"),
  ).toContainText("房间不存在");
  await expect(
    page.getByRole("button", { name: "进入房间", exact: true }),
  ).toBeEnabled();
});

test("switching a selected microphone back to system default updates the active capture", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    const probe = { calls: 0 };
    Object.assign(window, { deviceSwitchProbe: probe });
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      probe.calls++;
      return original(constraints);
    };
  });
  await guest(page, "默认设备回归");
  await page.getByRole("button", { name: "创建私人房间", exact: true }).click();
  await page.getByLabel("房间名称").fill("默认设备切换测试");
  await page.getByRole("button", { name: "创建并进入" }).click();
  await expect(
    page.getByRole("button", { name: "关闭麦克风", exact: true }),
  ).toBeEnabled();
  const calls = () =>
    page.evaluate(
      () =>
        (window as unknown as { deviceSwitchProbe: { calls: number } })
          .deviceSwitchProbe.calls,
    );
  try {
    await page
      .getByRole("button", { name: "音频设备设置", exact: true })
      .click();
    const select = page.getByRole("combobox", { name: "麦克风", exact: true });
    await select.click();
    await expect
      .poll(() => page.getByRole("option").count())
      .toBeGreaterThan(1);
    const before = await calls();
    await page.getByRole("option").last().click();
    await page.getByRole("button", { name: "保存设置", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect.poll(calls).toBeGreaterThan(before);
    const selectedCalls = await calls();
    await page
      .getByRole("button", { name: "音频设备设置", exact: true })
      .click();
    await page.getByRole("combobox", { name: "麦克风", exact: true }).click();
    await page
      .getByRole("option", { name: "系统默认麦克风", exact: true })
      .click();
    await page.getByRole("button", { name: "保存设置", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect.poll(calls).toBeGreaterThan(selectedCalls);
  } finally {
    await page.getByRole("button", { name: "离开房间", exact: true }).click();
  }
});

test("enabling push-to-talk mutes immediately and chat typing cannot release a latched microphone", async ({
  page,
}) => {
  await desktopTalkBridge(page);
  await guest(page, "按键说话回归");
  await page.getByRole("button", { name: "创建私人房间", exact: true }).click();
  await page.getByLabel("房间名称").fill("按键说话行为测试");
  await page.getByRole("button", { name: "创建并进入" }).click();
  await expect(
    page.getByRole("button", { name: "关闭麦克风", exact: true }),
  ).toBeEnabled();
  try {
    await page
      .getByRole("button", { name: "音频设备设置", exact: true })
      .click();
    await page.getByRole("tab", { name: "共享与快捷键", exact: true }).click();
    await page.getByRole("checkbox", { name: /^按键说话/ }).check();
    await page.getByRole("button", { name: "保存设置", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "开启麦克风", exact: true }),
    ).toBeVisible();
    await page.getByRole("slider", { name: "语音音量", exact: true }).focus();
    await page.keyboard.down("Space");
    const sliderStayedMuted = await page.evaluate(
      () =>
        new Promise<boolean>((resolve) => {
          let frames = 0;
          const sample = () => {
            if (document.querySelector('[aria-label="关闭麦克风"]'))
              resolve(false);
            else if (++frames >= 30) resolve(true);
            else requestAnimationFrame(sample);
          };
          sample();
        }),
    );
    await page.keyboard.up("Space");
    expect(
      sliderStayedMuted,
      "Space on an Ant Design slider must not start push-to-talk",
    ).toBe(true);
    await page.locator(".stage").click({ position: { x: 8, y: 8 } });
    for (const modifier of ["Control", "Alt", "Meta", "Shift"]) {
      await page.keyboard.down(modifier);
      await page.keyboard.down("Space");
      const stayedMuted = await page.evaluate(
        () =>
          new Promise<boolean>((resolve) => {
            let frames = 0;
            const sample = () => {
              if (document.querySelector('[aria-label="关闭麦克风"]'))
                resolve(false);
              else if (++frames >= 45) resolve(true);
              else requestAnimationFrame(sample);
            };
            sample();
          }),
      );
      expect(
        stayedMuted,
        `${modifier}+Space must not create a foreground hold`,
      ).toBe(true);
      await page.keyboard.up("Space");
      await page.keyboard.up(modifier);
    }
    await page.keyboard.down("Space");
    await expect(
      page.getByRole("button", { name: "关闭麦克风", exact: true }),
    ).toBeVisible();
    await page.keyboard.up("Space");
    await expect(
      page.getByRole("button", { name: "开启麦克风", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "开启麦克风", exact: true }).click();
    await page.getByRole("tab", { name: "聊天", exact: true }).click();
    await page
      .getByRole("textbox", { name: "聊天消息", exact: true })
      .press("Space");
    await expect(
      page.getByRole("button", { name: "关闭麦克风", exact: true }),
    ).toBeVisible();
  } finally {
    await page.keyboard.up("Space");
    for (const modifier of ["Control", "Alt", "Meta", "Shift"])
      await page.keyboard.up(modifier);
    await page.getByRole("button", { name: "离开房间", exact: true }).click();
  }
});

test("a microphone grant arriving after push-to-talk release cannot leave the microphone live", async ({
  page,
}) => {
  await desktopTalkBridge(page);
  await page.addInitScript(() => {
    localStorage.setItem(
      "cinegather.settings",
      JSON.stringify({
        pushToTalk: true,
        minimizeToTray: false,
        quality: "cinema",
        pttShortcut: "CommandOrControl+Shift+Space",
        muteShortcut: "CommandOrControl+Shift+M",
        inputDevice: "",
        outputDevice: "",
      }),
    );
    const original = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    const probe = {
      tracks: [] as MediaStreamTrack[],
      release: undefined as (() => void) | undefined,
    };
    Object.assign(window, { delayedTalkProbe: probe });
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await original(constraints);
      probe.tracks.push(...stream.getTracks());
      await new Promise<void>((resolve) => {
        probe.release = resolve;
      });
      return stream;
    };
  });
  await guest(page, "迟到开麦回归");
  await page.getByRole("button", { name: "创建私人房间", exact: true }).click();
  await page.getByLabel("房间名称").fill("迟到授权测试");
  await page.getByRole("button", { name: "创建并进入" }).click();
  await expect(
    page.getByRole("button", { name: "开启麦克风", exact: true }),
  ).toBeEnabled();
  await page.locator(".stage").click({ position: { x: 8, y: 8 } });
  try {
    await page.keyboard.down("Space");
    await expect
      .poll(() =>
        page.evaluate(() =>
          Boolean(
            (
              window as unknown as {
                delayedTalkProbe: { release?: () => void };
              }
            ).delayedTalkProbe.release,
          ),
        ),
      )
      .toBe(true);
    await page.keyboard.up("Space");
    // The SDK waits only ten seconds for pending publication. Model a user who
    // grants OS microphone permission after that wait has already timed out.
    await page.waitForTimeout(10_500);
    await page.evaluate(() =>
      (
        window as unknown as { delayedTalkProbe: { release: () => void } }
      ).delayedTalkProbe.release(),
    );
    await expect
      .poll(() =>
        page.evaluate(() =>
          (
            window as unknown as {
              delayedTalkProbe: { tracks: MediaStreamTrack[] };
            }
          ).delayedTalkProbe.tracks.every(
            (track) => !track.enabled || track.readyState === "ended",
          ),
        ),
      )
      .toBe(true);
    await expect(
      page.getByRole("button", { name: "开启麦克风", exact: true }),
    ).toBeVisible();
  } finally {
    await page.keyboard.up("Space");
    await page.evaluate(() => {
      const probe = (
        window as unknown as {
          delayedTalkProbe: {
            release?: () => void;
            tracks: MediaStreamTrack[];
          };
        }
      ).delayedTalkProbe;
      probe.release?.();
      probe.tracks.forEach((track) => track.stop());
    });
    await page.getByRole("button", { name: "离开房间", exact: true }).click();
  }
});

test("push-to-talk released during an SFU outage stays muted after reconnection", async ({
  page,
}) => {
  await desktopTalkBridge(page);
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  await guest(page, "重连按键说话");
  await page.getByRole("button", { name: "创建私人房间", exact: true }).click();
  await page.getByLabel("房间名称").fill("重连静音意图测试");
  await page.getByRole("button", { name: "创建并进入" }).click();
  await page.getByRole("button", { name: "音频设备设置", exact: true }).click();
  await page.getByRole("tab", { name: "共享与快捷键", exact: true }).click();
  await page.getByRole("checkbox", { name: /^按键说话/ }).check();
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "开启麦克风", exact: true }),
  ).toBeVisible();
  await page.locator(".stage").click({ position: { x: 8, y: 8 } });
  try {
    await page.keyboard.down("Space");
    await expect(
      page.getByRole("button", { name: "关闭麦克风", exact: true }),
    ).toBeVisible();
    await promisify(execFile)("docker", [
      "compose",
      "--env-file",
      ".env",
      "-f",
      "infra/compose/dev.yml",
      "restart",
      "--timeout",
      "1",
      "livekit",
    ]);
    await expect(page.locator(".connection")).toHaveText(/重新连接|断开/, {
      timeout: 15000,
    });
    await page.keyboard.up("Space");
    await expect(page.locator(".connection")).toHaveText("已连接", {
      timeout: 30000,
    });
    await expect(
      page.getByRole("button", { name: "开启麦克风", exact: true }),
    ).toBeVisible();
  } finally {
    await page.keyboard.up("Space");
    await page.getByRole("button", { name: "离开房间", exact: true }).click();
  }
});

test("the source picker forwards audio opt-in and excludes CineGather playback from system capture", async ({
  page,
}) => {
  await guest(page, "声音选项验证");
  await page.getByRole("button", { name: "创建私人房间", exact: true }).click();
  await page.getByLabel("房间名称").fill("声音选项验证");
  await page.getByRole("button", { name: "创建并进入" }).click();
  await page.getByRole("button", { name: "关闭麦克风", exact: true }).waitFor();
  // Only the desktop bridge is simulated. Chromium and LiveKit capture/publish
  // normally; observe the exact constraints at the browser API boundary.
  await page.evaluate(() => {
    const original = navigator.mediaDevices.getDisplayMedia.bind(
      navigator.mediaDevices,
    );
    navigator.mediaDevices.getDisplayMedia = (options) => {
      Object.assign(window, { screenCaptureOptions: options });
      return original(options);
    };
    Object.assign(window, {
      desktop: {
        platform: "darwin",
        sources: async () => [
          {
            id: "screen:test",
            name: "Test screen",
            kind: "screen",
            thumbnail: "",
          },
        ],
        selectSource: async () => {},
        cancelCapture: async () => {},
        setSharing: async () => {},
      },
    });
  });
  try {
    for (const audio of [false, true]) {
      await page
        .getByRole("button", { name: "选择屏幕开始共享", exact: true })
        .click();
      await page.locator(".source-card").first().click();
      await page
        .getByRole("checkbox", { name: "共享系统声音" })
        .setChecked(audio);
      await page.getByRole("button", { name: "确认共享", exact: true }).click();
      await expect(page.locator(".sharing-banner")).toBeVisible();
      expect(
        await page.evaluate(
          () =>
            (
              window as unknown as {
                screenCaptureOptions: DisplayMediaStreamOptions;
              }
            ).screenCaptureOptions.audio,
        ),
      ).toEqual(
        audio
          ? {
              restrictOwnAudio: true,
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
              channelCount: 2,
            }
          : false,
      );
      await page
        .locator(".sharing-banner")
        .getByRole("button", { name: "停止共享" })
        .click();
    }
  } finally {
    await page.getByRole("button", { name: "离开房间", exact: true }).click();
  }
});

test("a hotkey status failure cannot disable the user's saved push-to-talk mode", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.assign(window, {
      desktop: {
        platform: "darwin",
        loadSettings: async () => ({
          minimizeToTray: true,
          pushToTalk: true,
          pttShortcut: "Control+Alt+K",
          muteShortcut: "CommandOrControl+Shift+M",
          quality: "cinema",
          inputDevice: "",
          outputDevice: "",
        }),
        hotkeyStatus: async () => {
          throw Error("diagnostic unavailable");
        },
        takeInvitation: async () => undefined,
        onAction: () => () => {},
      },
    });
  });
  await page.goto("/");
  await page.getByRole("menuitem", { name: "设置与设备", exact: true }).click();
  await page.getByRole("tab", { name: "共享与快捷键", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "按键说话" })).toBeChecked();
});
