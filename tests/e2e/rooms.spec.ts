import { test, expect, type Page } from "@playwright/test";
import { RoomServiceClient, TrackSource } from "livekit-server-sdk";
import pg from "pg";
async function guest(page: Page, name: string) {
  await page.goto("/");
  await page.getByLabel("你的昵称").fill(name);
  await page.getByRole("button", { name: "进入映聚", exact: true }).click();
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
    await friend.getByLabel("邀请链接或完整房间码").fill(invite);
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
    await page.getByRole("button", { name: "聊天", exact: true }).click();
    await friend.getByRole("button", { name: "聊天", exact: true }).click();
    await friend.getByLabel("聊天消息").fill("今晚一起看！");
    await friend.getByRole("button", { name: "发送消息" }).click();
    await expect(page.locator(".chat-message")).toContainText("今晚一起看！");
    await page.screenshot({ path: ".local/room-ui.png", fullPage: true });
    await friend.getByRole("button", { name: "离开房间" }).click();
    await page.getByRole("button", { name: /成员/ }).click();
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
  await page.getByRole("button", { name: "设置与设备", exact: true }).click();
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
    await viewer.getByLabel("邀请链接或完整房间码").fill(invite.toString());
    await viewer.getByRole("button", { name: "进入房间", exact: true }).click();
    await expect(
      viewer.getByRole("heading", { name: "共享权限测试" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "选择屏幕开始共享" }).click();
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
test("revoking an active guest session disconnects its existing media identity", async ({
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
  const revoked = await request.delete(
    "http://127.0.0.1:14310/api/v1/session",
    { headers: { Authorization: `Bearer ${token}` } },
  );
  expect(revoked.status()).toBe(200);
  await expect
    .poll(async () => (await livekit.listParticipants(roomId)).length, {
      timeout: 12000,
    })
    .toBe(0);
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
