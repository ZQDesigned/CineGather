import { test, expect, type Page } from "@playwright/test";
import { IngressClient, RoomServiceClient } from "livekit-server-sdk";
import pg from "pg";
const apiBase = process.env.VITE_API_URL ?? "http://127.0.0.1:14310";
async function request(
  page: Page,
  room: string,
  suffix: string,
  body?: unknown,
  method = "POST",
) {
  const token = await page.evaluate(() =>
    localStorage.getItem("cinegather.session"),
  );
  const response = await fetch(`${apiBase}/api/v1/rooms/${room}${suffix}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json() };
}
test("native ingress belongs to the live lease, rotates keys, and is revoked on release/expiry/leave", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "访客体验", exact: true }).click();
  await page.getByLabel("你的昵称").fill("原生权限测试");
  await page.getByRole("button", { name: "进入映聚", exact: true }).click();
  await page.getByRole("button", { name: "创建私人房间", exact: true }).click();
  await page.getByLabel("房间名称").fill("原生租约测试");
  await page.getByRole("button", { name: "创建并进入" }).click();
  await expect(
    page.getByRole("button", { name: "关闭麦克风", exact: true }),
  ).toBeEnabled();
  const room = await page.evaluate(async (apiBase) => {
    const token = localStorage.getItem("cinegather.session");
    const r = await fetch(apiBase + "/api/v1/rooms", {
      headers: { Authorization: `Bearer ${token}` },
    });
    return (await r.json()).items[0].id as string;
  }, apiBase);
  const admin = new IngressClient(
    process.env.LIVEKIT_INTERNAL_URL!,
    process.env.LIVEKIT_API_KEY!,
    process.env.LIVEKIT_API_SECRET!,
  );
  const media = new RoomServiceClient(
    process.env.LIVEKIT_INTERNAL_URL!,
    process.env.LIVEKIT_API_KEY!,
    process.env.LIVEKIT_API_SECRET!,
  );
  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  let lastId: string | undefined;
  try {
    const lease = (await request(page, room, "/share-lease")).body;
    const stale = { leaseId: lease.leaseId, revision: lease.revision + 1 };
    expect(
      (await request(page, room, "/share-lease/native", stale)).status,
    ).toBe(409);
    const created = await request(page, room, "/share-lease/native", {
      leaseId: lease.leaseId,
      revision: lease.revision,
    });
    expect(created.status).toBe(201);
    expect(created.body.identity).toContain(lease.holderUserId);
    const same = await request(page, room, "/share-lease/native", {
      leaseId: lease.leaseId,
      revision: lease.revision,
    });
    expect(same.body.token).toBe(created.body.token);
    expect(
      (await media.listParticipants(room))[0]!.permission?.canPublishSources,
    ).toEqual([2]);
    const entries = await admin.listIngress({ roomName: room });
    expect(entries).toHaveLength(1);
    lastId = entries[0]!.ingressId;
    await request(
      page,
      room,
      "/share-lease",
      { leaseId: lease.leaseId, revision: lease.revision },
      "DELETE",
    );
    expect(await admin.listIngress({ roomName: room })).toHaveLength(0);
    const oldKey = await fetch(created.body.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${created.body.token}`,
        "Content-Type": "application/sdp",
      },
      body: "v=0\r\n",
    });
    expect(oldKey.status).toBe(404);
    const nextLease = (await request(page, room, "/share-lease")).body;
    const next = (
      await request(page, room, "/share-lease/native", {
        leaseId: nextLease.leaseId,
        revision: nextLease.revision,
      })
    ).body;
    expect(next.token).not.toBe(created.body.token);
    await db.query(
      "UPDATE share_leases SET expires_at = now() - interval '1 second' WHERE room_id = $1",
      [room],
    );
    await expect
      .poll(async () => (await admin.listIngress({ roomName: room })).length, {
        timeout: 15000,
      })
      .toBe(0);
    const finalLease = (await request(page, room, "/share-lease")).body;
    expect(
      (
        await request(page, room, "/share-lease/native", {
          leaseId: finalLease.leaseId,
          revision: finalLease.revision,
        })
      ).status,
    ).toBe(201);
    await page.getByRole("button", { name: "离开房间" }).click();
    await expect
      .poll(async () => (await admin.listIngress({ roomName: room })).length)
      .toBe(0);
    expect(
      (
        await request(page, room, "/share-lease/native", {
          leaseId: finalLease.leaseId,
          revision: finalLease.revision,
        })
      ).status,
    ).toBe(404);
  } finally {
    if (lastId) await admin.deleteIngress(lastId).catch(() => {});
    await media.deleteRoom(room).catch(() => {});
    await db.end();
  }
});

test("kick, session revocation and crash-orphan reconciliation revoke native publication keys", async ({
  page,
  browser,
}) => {
  const admin = new IngressClient(
    process.env.LIVEKIT_INTERNAL_URL!,
    process.env.LIVEKIT_API_KEY!,
    process.env.LIVEKIT_API_SECRET!,
  );
  const media = new RoomServiceClient(
    process.env.LIVEKIT_INTERNAL_URL!,
    process.env.LIVEKIT_API_KEY!,
    process.env.LIVEKIT_API_SECRET!,
  );
  await page.goto("/");
  await page.getByRole("button", { name: "访客体验", exact: true }).click();
  await page.getByLabel("你的昵称").fill("原生撤销房主");
  await page.getByRole("button", { name: "进入映聚", exact: true }).click();
  await page.getByRole("button", { name: "创建私人房间", exact: true }).click();
  await page.getByLabel("房间名称").fill("原生撤销测试");
  await page.getByRole("button", { name: "创建并进入" }).click();
  await expect(
    page.getByRole("button", { name: "关闭麦克风", exact: true }),
  ).toBeEnabled();
  const ownerToken = await page.evaluate(() =>
    localStorage.getItem("cinegather.session"),
  );
  const room = (
    await fetch(apiBase + "/api/v1/rooms", {
      headers: { Authorization: `Bearer ${ownerToken}` },
    }).then((r) => r.json())
  ).items[0].id as string;
  const invitation = (
    await request(page, room, "/invites", { expiresInHours: 1, maxUses: 2 })
  ).body;
  const context = await browser.newContext({ permissions: ["microphone"] });
  const friend = await context.newPage();
  try {
    await friend.goto("/");
    await friend.getByRole("button", { name: "访客体验", exact: true }).click();
    await friend.getByLabel("你的昵称").fill("原生撤销成员");
    await friend.getByRole("button", { name: "进入映聚", exact: true }).click();
    await friend.getByRole("button", { name: "加入房间", exact: true }).click();
    await friend
      .getByLabel("房间号或邀请链接")
      .fill(`cinegather://join?room=${room}&invite=${invitation.token}`);
    await friend.getByRole("button", { name: "进入房间", exact: true }).click();
    await expect(
      friend.getByRole("button", { name: "关闭麦克风", exact: true }),
    ).toBeEnabled();
    const lease = (await request(friend, room, "/share-lease")).body;
    expect(
      (
        await request(friend, room, "/share-lease/native", {
          leaseId: lease.leaseId,
          revision: lease.revision,
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await request(page, room, "/share-lease/native", {
          leaseId: lease.leaseId,
          revision: lease.revision,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(
          page,
          room,
          `/members/${lease.holderUserId}`,
          { ban: true },
          "DELETE",
        )
      ).status,
    ).toBe(200);
    expect(await admin.listIngress({ roomName: room })).toHaveLength(0);
    const ownerLease = (await request(page, room, "/share-lease")).body;
    expect(
      (
        await request(page, room, "/share-lease/native", {
          leaseId: ownerLease.leaseId,
          revision: ownerLease.revision,
        })
      ).status,
    ).toBe(201);
    const response = await fetch(apiBase + "/api/v1/session", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    expect(response.status).toBe(200);
    expect(await admin.listIngress({ roomName: room })).toHaveLength(0);
    // Reproduce the external-create/DB-commit crash window. No row is persisted.
    const { IngressInput } = await import("livekit-server-sdk");
    await admin.createIngress(IngressInput.WHIP_INPUT, {
      name: `cinegather/native/v1/${crypto.randomUUID()}`,
      roomName: room,
      participantIdentity: `cg-native:${ownerLease.holderUserId}:${crypto.randomUUID()}`,
      enableTranscoding: false,
    });
    await expect
      .poll(async () => (await admin.listIngress({ roomName: room })).length, {
        timeout: 15000,
      })
      .toBe(0);
  } finally {
    for (const entry of await admin.listIngress({ roomName: room }))
      await admin.deleteIngress(entry.ingressId);
    await media.deleteRoom(room).catch(() => {});
    await context.close();
  }
});
