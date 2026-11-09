import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { RoomServiceClient } from "livekit-server-sdk";
import { participantOwner } from "@cinegather/contracts";
const media = new RoomServiceClient(
  process.env.LIVEKIT_INTERNAL_URL!,
  process.env.LIVEKIT_API_KEY!,
  process.env.LIVEKIT_API_SECRET!,
);
import { createDatabase } from "@cinegather/database";
const api = process.env.PROFILE_TEST_API_URL ?? "http://127.0.0.1:14310/api/v1";
const created: string[] = [];
const { pool } = createDatabase(process.env.DATABASE_URL!);
test.beforeAll(async () => {
  if (
    !["127.0.0.1", "localhost"].includes(
      new URL(process.env.DATABASE_URL!).hostname,
    )
  )
    throw new Error("Local fixture database required");
  const stale = await pool.query(
    "SELECT id FROM users WHERE username ~ '^profileui_[0-9a-f]{8}$'",
  );
  created.push(...stale.rows.map((r) => r.id));
  await cleanup();
});
async function cleanup() {
  const ids = created.splice(0);
  if (!ids.length) return;
  const rooms = await pool.query(
    "SELECT DISTINCT r.id FROM rooms r LEFT JOIN room_members m ON m.room_id = r.id WHERE r.owner_user_id = ANY($1::uuid[]) OR m.user_id = ANY($1::uuid[])",
    [ids],
  );
  for (const room of rooms.rows)
    if ((await media.listRooms([room.id])).length)
      await media.deleteRoom(room.id);
  await pool.query("DELETE FROM rooms WHERE id = ANY($1::uuid[])", [
    rooms.rows.map((r) => r.id),
  ]);
  await pool.query("DELETE FROM room_members WHERE user_id = ANY($1::uuid[])", [
    ids,
  ]);
  await pool.query(
    "DELETE FROM audit_logs WHERE actor_id = ANY($1::uuid[]) OR target_id = ANY($1::uuid[])",
    [ids],
  );
  await pool.query(
    "DELETE FROM idempotency_keys WHERE user_id = ANY($1::uuid[])",
    [ids],
  );
  await pool.query(
    "DELETE FROM users WHERE id = ANY($1::uuid[]) AND username ~ '^profileui_[0-9a-f]{8}$'",
    [ids],
  );
}
test.afterEach(cleanup);
test.afterAll(() => pool.end());
async function signIn(page: Page, name: string) {
  const result = await page.request.post(`${api}/accounts/register`, {
    data: {
      username: `profileui_${crypto.randomUUID().slice(0, 8)}`,
      displayName: name,
      password: "Profile test password 123!",
    },
  });
  expect(result.ok()).toBe(true);
  const session = await result.json();
  created.push(session.user.id);
  await page.goto("/");
  await page.evaluate(
    (token) => localStorage.setItem("cinegather.session", token),
    session.sessionToken,
  );
  await page.reload();
  await expect(page.locator(".profile-name")).toHaveText(name);
  return session;
}
test("account subpages save nicknames without disconnecting the room and update remote member names", async ({
  page,
  browser,
}) => {
  const account = await signIn(page, "改名前");
  await page.getByRole("button", { name: "创建私人房间", exact: true }).click();
  await page.getByLabel("房间名称").fill("昵称同步验证");
  await page.getByRole("button", { name: "创建并进入", exact: true }).click();
  await expect(page.locator(".connection")).toContainText("已连接");
  const rooms = await page.request.get(`${api}/rooms`, {
    headers: { Authorization: `Bearer ${account.sessionToken}` },
  });
  const roomId = (await rooms.json()).items[0].id;
  let context: BrowserContext | undefined;
  try {
    context = await browser.newContext({ permissions: ["microphone"] });
    const other = await context.newPage();
    const friend = await signIn(other, "旁观好友");
    await other.request.post(`${api}/rooms/${roomId}/join`, {
      headers: { Authorization: `Bearer ${friend.sessionToken}` },
      data: {},
    });
    await other.reload();
    await other
      .getByRole("button", { name: "进入昵称同步验证", exact: true })
      .click();
    await expect(
      other.locator(".member-name").filter({ hasText: "改名前" }),
    ).toBeVisible();
    await page
      .getByRole("menuitem", { name: "设置与设备", exact: true })
      .click();
    await page.getByRole("tab", { name: "账号与安全", exact: true }).click();
    await expect(page.getByLabel("当前密码", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "修改昵称", exact: true }).click();
    await page.getByLabel("昵称", { exact: true }).fill("取消的名字");
    await page
      .getByRole("button", { name: "返回账号与安全", exact: true })
      .click();
    await expect(page.locator(".profile-name")).toHaveText("改名前");
    await page.getByRole("button", { name: "修改昵称", exact: true }).click();
    await expect(page.getByLabel("昵称", { exact: true })).toHaveValue(
      "改名前",
    );
    await page.getByLabel("昵称", { exact: true }).fill("   ");
    await page.getByRole("button", { name: "保存昵称", exact: true }).click();
    await expect(page.getByText("请输入昵称", { exact: true })).toBeVisible();
    await page.getByLabel("昵称", { exact: true }).fill("  改名之后  ");
    await page.route(
      "**/api/v1/accounts/profile",
      (route) =>
        route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            code: "TEST_UNAVAILABLE",
            message: "暂时无法保存",
            requestId: "fixture",
          }),
        }),
      { times: 1 },
    );
    await page.getByRole("button", { name: "保存昵称", exact: true }).click();
    await expect(page.getByText("暂时无法保存", { exact: true })).toBeVisible();
    await expect(page.getByLabel("昵称", { exact: true })).toHaveValue(
      "  改名之后  ",
    );
    await page.getByRole("button", { name: "保存昵称", exact: true }).click();
    await expect(page.locator(".profile-name")).toHaveText("改名之后");
    await expect(page.locator(".connection")).toContainText("已连接");
    await expect(
      other.locator(".member-name").filter({ hasText: "改名之后" }),
    ).toBeVisible();
    const self = (await media.listParticipants(roomId)).find(
      (p) => participantOwner(p.identity) === account.user.id,
    )!;
    await media.updateParticipant(roomId, self.identity, {
      name: "媒体服务中的旧名字",
    });
    await expect
      .poll(
        async () =>
          (await media.listParticipants(roomId)).find(
            (p) => participantOwner(p.identity) === account.user.id,
          )?.name,
        { timeout: 12000 },
      )
      .toBe("改名之后");
    await expect(
      other.locator(".member-name").filter({ hasText: "改名之后" }),
    ).toBeVisible();
    await expect(
      page.locator(".member-name").filter({ hasText: "改名之后" }),
    ).toHaveText("改名之后");
    await page.screenshot({ path: ".local/account-profile/nickname-page.png" });
    await page
      .getByRole("button", { name: "返回账号与安全", exact: true })
      .click();
    await page.screenshot({
      path: ".local/account-profile/account-overview.png",
    });
    await page.getByRole("button", { name: "修改密码", exact: true }).click();
    await expect(page.getByLabel("当前密码", { exact: true })).toBeVisible();
    await expect(page.getByLabel("昵称", { exact: true })).toHaveCount(0);
    await page.reload();
    await expect(page.locator(".profile-name")).toHaveText("改名之后");
  } finally {
    await context?.close();
  }
});
