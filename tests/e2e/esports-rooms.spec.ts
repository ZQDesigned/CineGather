import { fileURLToPath } from "node:url";
import { writeFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";
import {
  createDatabase,
  users,
  rooms,
  members,
  credentials,
  auditLogs,
  idempotency,
} from "@cinegather/database";
import { eq, inArray } from "drizzle-orm";
if (
  !new URL(process.env.DATABASE_URL!).pathname.includes("esports") &&
  !process.env.CI
)
  throw Error("Use the isolated esports test database");
const { db, pool } = createDatabase(process.env.DATABASE_URL!);
const fixtureModule =
  "/@fs/" +
  fileURLToPath(new URL("../fixtures/esports-publisher.ts", import.meta.url))
    .replaceAll("\\", "/")
    .replace(/^\//, "");
const accounts: { id: string; token: string }[] = [];
test.afterAll(async () => {
  const ids = accounts.map((a) => a.id);
  if (ids.length)
    await db.transaction(async (tx) => {
      await tx.delete(rooms).where(inArray(rooms.ownerUserId, ids));
      await tx.delete(members).where(inArray(members.userId, ids));
      await tx.delete(auditLogs).where(inArray(auditLogs.actorId, ids));
      await tx.delete(idempotency).where(inArray(idempotency.userId, ids));
      await tx.delete(credentials).where(inArray(credentials.userId, ids));
      await tx.delete(users).where(inArray(users.id, ids));
    });
  await pool.end();
});
test("web uses the shared esports room UI, starts in audience, and applies server seat changes without re-entry", async ({
  page,
  request,
}) => {
  const response = await request.post(
    "http://127.0.0.1:17883/api/v1/accounts/register",
    {
      data: {
        username: "esports_ui_" + crypto.randomUUID().slice(0, 8),
        displayName: "赛事房主",
        password: "Esports UI validation 123!",
      },
      headers: {
        "X-CineGather-Features": "esports-v1",
        "X-CineGather-Platform": "web",
      },
    },
  );
  expect(response.ok()).toBeTruthy();
  const account = await response.json();
  accounts.push({ id: account.user.id, token: account.sessionToken });
  await db
    .update(users)
    .set({ esportsRoomsEnabled: true })
    .where(eq(users.id, account.user.id));
  page.on("pageerror", (error) =>
    console.log("renderer error:", error.message),
  );
  await page.addInitScript(
    (token) => localStorage.setItem("cinegather.session", token),
    account.sessionToken,
  );
  await page.goto("/");
  await page.getByRole("button", { name: "创建私人房间", exact: true }).click();
  await expect(page.getByRole("radio", { name: "电竞赛事房" })).toBeVisible();
  await page.getByRole("radio", { name: "电竞赛事房" }).check();
  await page.getByRole("button", { name: "创建并进入" }).click();
  await expect(page.getByTestId("esports-room")).toBeVisible();
  await expect(page.getByTestId("esports-seat")).toContainText("观众");
  await expect(
    page.getByRole("button", { name: "共享屏幕", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "聊天" })).toHaveCount(0);
  const all = await request.get("http://127.0.0.1:17883/api/v1/rooms", {
    headers: {
      Authorization: "Bearer " + account.sessionToken,
      "X-CineGather-Features": "esports-v1",
    },
  });
  const room = (await all.json()).items[0];
  const assigned = await request.post(
    `http://127.0.0.1:17883/api/v1/rooms/${room.id}/esports/members/${account.user.id}/seat`,
    {
      data: { kind: "player", team: "a" },
      headers: { Authorization: "Bearer " + account.sessionToken },
    },
  );
  expect(assigned.ok()).toBeTruthy();
  await expect(page.getByTestId("esports-seat")).toContainText("A 组选手");
  await expect(
    page.getByRole("button", { name: "共享屏幕", exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("esports-watch-choice")).toHaveCount(0);
});

test("actual 1080p video prewarms to a decoded frame and a stalled replacement preserves the prior picture", async ({
  page,
  request,
  browser,
}) => {
  test.setTimeout(90000);
  const register = async (name: string) => {
    const r = await request.post(
      "http://127.0.0.1:17883/api/v1/accounts/register",
      {
        data: {
          username: "esports_ui_" + crypto.randomUUID().slice(0, 8),
          displayName: name,
          password: "Esports UI validation 123!",
        },
        headers: {
          "X-CineGather-Features": "esports-v1",
          "X-CineGather-Platform": "web",
        },
      },
    );
    expect(r.ok()).toBeTruthy();
    const data = await r.json();
    const account = { id: data.user.id, token: data.sessionToken };
    accounts.push(account);
    return account;
  };
  const owner = await register("测试观众"),
    a = await register("选手A"),
    b = await register("选手B");
  await db
    .update(users)
    .set({ esportsRoomsEnabled: true })
    .where(eq(users.id, owner.id));
  const post = async (path: string, token: string, data: unknown = {}) => {
    const r = await request.post("http://127.0.0.1:17883/api/v1" + path, {
      data,
      headers: {
        Authorization: "Bearer " + token,
        "X-CineGather-Features": "esports-v1",
      },
    });
    expect(r.ok(), path).toBeTruthy();
    return r.json();
  };
  await page.addInitScript(
    (token) => localStorage.setItem("cinegather.session", token),
    owner.token,
  );
  await page.goto("/");
  await page.getByRole("button", { name: "创建私人房间", exact: true }).click();
  await page.getByRole("radio", { name: "电竞赛事房" }).check();
  await page.getByRole("button", { name: "创建并进入" }).click();
  await expect(page.getByTestId("esports-seat")).toContainText("观众");
  const list = await request.get("http://127.0.0.1:17883/api/v1/rooms", {
      headers: {
        Authorization: "Bearer " + owner.token,
        "X-CineGather-Features": "esports-v1",
      },
    }),
    room = (await list.json()).items[0];
  const contexts = [];
  const sources = [];
  try {
    for (const [account, team] of [
      [a, "a"],
      [b, "b"],
    ] as const) {
      const control = await post(`/rooms/${room.id}/join`, account.token);
      await post(
        `/rooms/${room.id}/esports/members/${account.id}/seat`,
        owner.token,
        { kind: "player", team },
      );
      const voice = await post(
          `/rooms/${room.id}/esports/connection`,
          account.token,
          { channel: { kind: "team", team }, seatRevision: 2 },
        ),
        lease = await post(
          `/rooms/${room.id}/esports/share-lease`,
          account.token,
        );
      const video = await post(
        `/rooms/${room.id}/esports/connection`,
        account.token,
        {
          channel: { kind: "video", publicationId: lease.publicationId },
          seatRevision: 2,
        },
      );
      const context = await browser.newContext();
      contexts.push(context);
      const source = await context.newPage();
      sources.push({ source, lease, account });
      await source.goto("/");
      await source.evaluate(
        async (params) => {
          const fixture = await import(params.modulePath);
          (window as unknown as { esportsSource: unknown }).esportsSource =
            await fixture.startEsportsPublisher(
              params.control,
              params.voice,
              params.video,
              { label: params.label, deferFrames: params.defer },
            );
        },
        {
          modulePath: fixtureModule,
          control,
          voice,
          video,
          label: team === "a" ? "选手A" : "选手B",
          defer: team === "b",
        },
      );
    }
    await page.getByRole("button", { name: "观看 选手A" }).click();
    const video = page.locator(".esports-video video");
    await expect(video).toBeVisible();
    await expect
      .poll(() => video.evaluate((v) => (v as HTMLVideoElement).videoWidth))
      .toBe(1920);
    const current = await video.getAttribute("data-esports-video");
    expect(current).toContain(sources[0]!.lease.publicationId);
    const warmStarted = Date.now();
    await page.getByRole("button", { name: "观看 选手B" }).click();
    await expect(page.getByText("正在预热新画面")).toBeVisible();
    expect(await video.getAttribute("data-esports-video")).toBe(current);
    await expect(page.getByText("正在预热新画面")).toHaveCount(0, {
      timeout: 8000,
    });
    expect(Date.now() - warmStarted).toBeGreaterThan(4000);
    expect(await video.getAttribute("data-esports-video")).toBe(current);
    await sources[1]!.source.evaluate(() =>
      (
        window as unknown as { esportsSource: { start(): void } }
      ).esportsSource.start(),
    );
    await page.getByRole("button", { name: "观看 选手B" }).click();
    await expect(video).toHaveAttribute(
      "data-esports-video",
      new RegExp(sources[1]!.lease.publicationId),
    );
    await expect
      .poll(() =>
        video.evaluate(
          (v) =>
            (v as HTMLVideoElement).getVideoPlaybackQuality().totalVideoFrames,
        ),
      )
      .toBeGreaterThan(5);
    await expect(page.getByText("B 组选手语音", { exact: true })).toBeVisible();
    await page.screenshot({ path: ".local/esports-rooms/actual-viewer.png" });
  } catch (error) {
    const diagnostic = await page
      .evaluate(async () => {
        const modulePath = "/controller.ts";
        const actions = await import(modulePath);
        return {
          core: actions.esports.coordinator.diagnostics(),
          channels: await actions.esports.browser.diagnostics(),
          visible: document.visibilityState,
          text: document.body.innerText,
        };
      })
      .catch(() => undefined);
    await writeFile(
      ".local/esports-rooms/watch-failure.json",
      JSON.stringify(
        {
          diagnostic,
          sources: await Promise.all(
            sources.map((item) =>
              item.source
                .evaluate(async () => ({
                  stats: await (
                    window as unknown as {
                      esportsSource: { stats(): Promise<unknown> };
                    }
                  ).esportsSource.stats(),
                  visibility: document.visibilityState,
                }))
                .catch(() => null),
            ),
          ),
        },
        null,
        2,
      ),
    );
    throw error;
  } finally {
    for (const item of sources) {
      await item.source
        .evaluate(async () => {
          await (
            window as unknown as { esportsSource: { close(): Promise<void> } }
          ).esportsSource?.close();
        })
        .catch(() => {});
      await post(`/rooms/${room.id}/leave`, item.account.token).catch(() => {});
    }
    for (const context of contexts) await context.close();
    await post(`/rooms/${room.id}/leave`, owner.token).catch(() => {});
  }
});
