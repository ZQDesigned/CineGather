type PublisherFixture = Awaited<
  ReturnType<
    typeof import("../fixtures/esports-publisher").startEsportsPublisher
  >
>;
type ViewerFixture = Awaited<
  ReturnType<typeof import("../fixtures/esports-publisher").startEsportsViewer>
>;
import { resolve } from "node:path";
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
  resolve("tests/fixtures/esports-publisher.ts")
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
  const sources: {
    source: import("@playwright/test").Page;
    lease: { publicationId: string };
    account: { id: string; token: string };
  }[] = [];
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
    await expect
      .poll(async () => {
        const r = await request.get(
          `http://127.0.0.1:17883/api/v1/rooms/${room.id}/esports`,
          { headers: { Authorization: "Bearer " + owner.token } },
        );
        const value = await r.json();
        return value.publications.find(
          (p: { id: string }) => p.id === sources[0]!.lease.publicationId,
        )?.systemAudio;
      })
      .toBe(true);
    const current = await video.getAttribute("data-esports-video");
    expect(current).toContain(sources[0]!.lease.publicationId);
    const warmStarted = Date.now();
    await page.getByRole("button", { name: "观看 选手B" }).click();
    await expect(page.getByText("正在切换画面")).toBeVisible();
    expect(await video.getAttribute("data-esports-video")).toBe(current);
    await expect(page.getByText("正在切换画面")).toHaveCount(0, {
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
    await expect(page.getByText("B 组语音", { exact: true })).toBeVisible();
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

test("capacity proof: ten isolated 1080p30 sources and five directors plus five audience decode and switch independently", async ({
  browser,
  request,
}) => {
  test.skip(
    process.env.CG_ESPORTS_SCALE !== "1",
    "Opt-in local media capacity proof",
  );
  test.setTimeout(240000);
  const apiOrigin = "http://127.0.0.1:17883",
    contexts: Awaited<ReturnType<typeof browser.newContext>>[] = [];
  const actors: {
    account: { id: string; token: string };
    page: import("@playwright/test").Page;
    kind: "player" | "director" | "audience";
    publicationId?: string;
    lease?: { leaseId: string; revision: number };
  }[] = [];
  const post = async (path: string, token: string, data: unknown = {}) => {
    const r = await request.post(apiOrigin + "/api/v1" + path, {
      data,
      headers: {
        Authorization: "Bearer " + token,
        "X-CineGather-Features": "esports-v1",
        "X-CineGather-Platform": "web",
      },
    });
    const value = await r.json();
    expect(r.ok(), JSON.stringify(value)).toBeTruthy();
    return value;
  };
  const register = async (name: string) => {
    const r = await request.post(apiOrigin + "/api/v1/accounts/register", {
      data: {
        username: "esports_scale_" + crypto.randomUUID().slice(0, 8),
        displayName: name,
        password: "Esports scale proof 123!",
      },
      headers: {
        "X-CineGather-Features": "esports-v1",
        "X-CineGather-Platform": "web",
      },
    });
    expect(r.ok()).toBeTruthy();
    const value = await r.json(),
      account = { id: value.user.id, token: value.sessionToken };
    accounts.push(account);
    return account;
  };
  const owner = await register("导播1");
  await db
    .update(users)
    .set({ esportsRoomsEnabled: true })
    .where(eq(users.id, owner.id));
  const room = await post("/rooms", owner.token, {
    name: "20席媒体验证",
    mode: "esports",
  });
  const renewalErrors: string[] = [];
  const renewal = setInterval(() => {
    for (const actor of actors)
      if (actor.lease)
        void post(
          `/rooms/${room.id}/esports/share-lease/renew`,
          actor.account.token,
          actor.lease,
        ).catch((e) => renewalErrors.push(String(e)));
  }, 8000);
  try {
    for (const i of [
      10,
      ...Array.from({ length: 20 }, (_, i) => i).filter((i) => i !== 10),
    ]) {
      const kind = i < 10 ? "player" : i < 15 ? "director" : "audience",
        account = i === 10 ? owner : await register(`${kind}${i}`);
      const control = await post(`/rooms/${room.id}/join`, account.token);
      let revision = 1;
      if (kind !== "audience") {
        await post(
          `/rooms/${room.id}/esports/members/${account.id}/seat`,
          owner.token,
          kind === "player" ? { kind, team: i < 5 ? "a" : "b" } : { kind },
        );
        revision = 2;
      }
      const context = await browser.newContext();
      contexts.push(context);
      const page = await context.newPage();
      await page.goto("/");
      const actor: (typeof actors)[number] = {
        account,
        page,
        kind,
        publicationId: undefined as string | undefined,
      };
      actors.push(actor);
      if (kind === "player") {
        const lease = await post(
          `/rooms/${room.id}/esports/share-lease`,
          account.token,
        );
        actor.publicationId = lease.publicationId;
        actor.lease = { leaseId: lease.leaseId, revision: lease.revision };
        const voice = await post(
            `/rooms/${room.id}/esports/connection`,
            account.token,
            {
              channel: { kind: "team", team: i < 5 ? "a" : "b" },
              seatRevision: revision,
            },
          ),
          video = await post(
            `/rooms/${room.id}/esports/connection`,
            account.token,
            {
              channel: { kind: "video", publicationId: lease.publicationId },
              seatRevision: revision,
            },
          );
        await page.evaluate(
          async (p) => {
            const fixture = await import(p.modulePath);
            (
              window as unknown as {
                capacity: PublisherFixture | ViewerFixture;
              }
            ).capacity = await fixture.startEsportsPublisher(
              p.control,
              p.voice,
              p.video,
              { label: p.label },
            );
          },
          {
            modulePath: fixtureModule,
            control,
            voice,
            video,
            label: `选手${i}`,
          },
        );
      } else {
        await page.evaluate(
          async (p) => {
            const fixture = await import(p.modulePath);
            (
              window as unknown as {
                capacity: PublisherFixture | ViewerFixture;
              }
            ).capacity = await fixture.startEsportsViewer(
              p.origin,
              p.roomId,
              p.token,
              p.control,
            );
          },
          {
            modulePath: fixtureModule,
            origin: apiOrigin,
            roomId: room.id,
            token: account.token,
            control,
          },
        );
      }
    }
    const players = actors.filter((a) => a.kind === "player"),
      viewers = actors.filter((a) => a.kind !== "player");
    // Ten source leases remain independent throughout the proof.
    const renew = setInterval(() => {
      for (const actor of players)
        void actor.page
          .evaluate(() =>
            (window as unknown as { capacity: ViewerFixture }).capacity.stats(),
          )
          .catch(() => {});
    }, 10000);
    try {
      // Renew via fresh lease acquisition (idempotent existing lease) then renewal.
      const keepAlive = async () => {
        for (const a of players) {
          const lease = await post(
            `/rooms/${room.id}/esports/share-lease`,
            a.account.token,
          );
          await post(
            `/rooms/${room.id}/esports/share-lease/renew`,
            a.account.token,
            { leaseId: lease.leaseId, revision: lease.revision },
          );
        }
      };
      await keepAlive();
      await Promise.all(
        viewers.map((a, i) =>
          a.page.evaluate(
            (id) =>
              (
                window as unknown as { capacity: ViewerFixture }
              ).capacity.select(id),
            players[i]!.publicationId!,
          ),
        ),
      );
      const before = await Promise.all(
        viewers.map((a) =>
          a.page.evaluate(() =>
            (window as unknown as { capacity: ViewerFixture }).capacity.stats(),
          ),
        ),
      );
      for (const value of before) {
        expect(value.errors).toEqual([]);
        expect(value.video[0]?.width).toBe(1920);
        expect(value.video[0]?.height).toBe(1080);
      }
      await keepAlive();
      await new Promise((r) => setTimeout(r, 5000));
      await Promise.all(
        viewers.map((a, i) =>
          a.page.evaluate(
            (id) =>
              (
                window as unknown as { capacity: ViewerFixture }
              ).capacity.select(id),
            players[(i + 5) % 10]!.publicationId!,
          ),
        ),
      );
      const after = await Promise.all(
        viewers.map((a) =>
          a.page.evaluate(() =>
            (window as unknown as { capacity: ViewerFixture }).capacity.stats(),
          ),
        ),
      );
      expect(renewalErrors).toEqual([]);
      const sources = await Promise.all(
        players.map((a) =>
          a.page.evaluate(() =>
            (
              window as unknown as { capacity: PublisherFixture }
            ).capacity.stats(),
          ),
        ),
      );
      for (const [i, value] of after.entries()) {
        expect(value.errors).toEqual([]);
        expect(value.video[0]?.frames).toBeGreaterThan(0);
        expect(value.context.current).toBe(
          players[(i + 5) % 10]!.publicationId,
        );
        expect(value.channels.filter((c) => c.kind === "video")).toHaveLength(
          1,
        );
      }
      for (const value of sources) {
        const voice = value.rooms[1]!;
        expect(
          voice.peers.filter((p) =>
            p.tracks.some((t) => t.source === "microphone" && t.subscribed),
          ),
        ).toHaveLength(4);
        expect(
          voice.peers
            .filter((p) => !p.name?.startsWith("player"))
            .every((p) => p.tracks.length === 0),
        ).toBe(true);
        expect(value.outbound[0]?.framesEncoded).toBeGreaterThan(10);
        expect(value.outbound[0]?.framesPerSecond).toBeGreaterThanOrEqual(25);
        expect(value.outbound[0]?.frameWidth).toBe(1920);
      }
      await writeFile(
        ".local/esports-rooms/evidence/capacity-20.json",
        JSON.stringify(
          { at: new Date().toISOString(), before, after, sources },
          null,
          2,
        ),
      );
    } finally {
      clearInterval(renew);
    }
  } finally {
    clearInterval(renewal);
    await Promise.all(
      actors.map((a) =>
        a.page
          .evaluate(() =>
            (
              window as unknown as {
                capacity?: PublisherFixture | ViewerFixture;
              }
            ).capacity?.close(),
          )
          .catch(() => {}),
      ),
    );
    await Promise.all(contexts.map((c) => c.close()));
  }
});

test("owner adjusts esports seats directly from roster and player context menus with capability-specific actions", async ({
  page,
  request,
  browser,
}) => {
  test.setTimeout(60000);
  const register = async (name: string) => {
    const r = await request.post(
      "http://127.0.0.1:17883/api/v1/accounts/register",
      {
        data: {
          username: "seat_menu_" + crypto.randomUUID().slice(0, 8),
          displayName: name,
          password: "Esports menu verification 123!",
        },
        headers: {
          "X-CineGather-Features": "esports-v1",
          "X-CineGather-Platform": "web",
        },
      },
    );
    expect(r.ok()).toBeTruthy();
    const result = await r.json();
    const account = { id: result.user.id, token: result.sessionToken };
    accounts.push(account);
    return account;
  };
  const owner = await register("右键房主"),
    target = await register("右键成员");
  await db
    .update(users)
    .set({ esportsRoomsEnabled: true })
    .where(eq(users.id, owner.id));
  await page.addInitScript(
    (token) => localStorage.setItem("cinegather.session", token),
    owner.token,
  );
  await page.goto("/");
  await page.getByRole("button", { name: "创建私人房间", exact: true }).click();
  await page.getByRole("radio", { name: "电竞赛事房" }).check();
  await page.getByRole("button", { name: "创建并进入" }).click();
  await expect(page.getByTestId("esports-room")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "席位管理", exact: true }),
  ).toHaveCount(0);
  const listed = await request.get("http://127.0.0.1:17883/api/v1/rooms", {
    headers: {
      Authorization: "Bearer " + owner.token,
      "X-CineGather-Features": "esports-v1",
    },
  });
  const room = (await listed.json()).items[0];
  const context = await browser.newContext();
  try {
    await context.addInitScript(
      (token) => localStorage.setItem("cinegather.session", token),
      target.token,
    );
    const peer = await context.newPage();
    await peer.goto("http://127.0.0.1:5181/");
    await peer.getByRole("button", { name: "加入房间", exact: true }).click();
    await peer
      .getByPlaceholder("输入 8 位房间号或粘贴邀请链接")
      .fill(room!.code);
    await peer.getByRole("button", { name: "进入房间", exact: true }).click();
    await expect(peer.getByTestId("esports-room")).toBeVisible();
    const menu = page.locator(".member-context-popup");
    await page
      .getByRole("button", { name: "右键成员的成员操作", exact: true })
      .click();
    await expect(
      menu.getByRole("menuitem", { name: "调整席位", exact: true }),
    ).toBeVisible();
    await expect(
      menu.getByRole("menuitem", { name: "关闭伴奏", exact: true }),
    ).toHaveCount(0);
    await expect(
      menu.getByRole("menuitemcheckbox", { name: "禁止共享", exact: true }),
    ).toHaveCount(0);
    await menu.getByRole("menuitem", { name: "调整席位", exact: true }).hover();
    await page.getByRole("menuitem", { name: "A 组选手", exact: true }).click();
    await expect(peer.getByTestId("esports-seat")).toHaveText("A 组选手");
    // Unpublished player tiles must still accept right-clicks.
    await page
      .getByRole("button", { name: "观看 右键成员", exact: true })
      .click({ button: "right", force: true });
    await expect(
      menu.getByRole("menuitemcheckbox", { name: "禁止共享", exact: true }),
    ).toBeVisible();
    await expect(
      menu.getByRole("menuitem", { name: "停止共享", exact: true }),
    ).toHaveCount(0);
    await expect(
      menu.getByRole("menuitem", { name: "关闭伴奏", exact: true }),
    ).toHaveCount(0);
    await menu.getByRole("menuitem", { name: "调整席位", exact: true }).hover();
    await page.getByRole("menuitem", { name: "导播席", exact: true }).click();
    await expect(peer.getByTestId("esports-seat")).toHaveText("导播");
    await page
      .getByRole("button", { name: "右键成员的成员操作", exact: true })
      .click();
    await expect(
      menu.getByRole("menuitemcheckbox", { name: "禁止共享", exact: true }),
    ).toHaveCount(0);
    await expect(
      menu.getByRole("menuitemcheckbox", { name: "禁止开麦", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: "右键房主的成员操作", exact: true })
      .click();
    await expect(
      menu.getByRole("menuitem", { name: "转移房主", exact: true }),
    ).toHaveCount(0);
    await expect(
      menu.getByRole("menuitem", { name: "移出房间", exact: true }),
    ).toHaveCount(0);
    await menu.getByRole("menuitem", { name: "调整席位", exact: true }).hover();
    await page.getByRole("menuitem", { name: "B 组选手", exact: true }).click();
    await expect(page.getByTestId("esports-seat")).toHaveText("B 组选手");
    await page
      .getByLabel("右键房主的成员操作", { exact: true })
      .click({ button: "right" });
    await expect(
      menu.getByRole("menuitem", { name: "调整席位", exact: true }),
    ).toBeVisible();
    await expect(
      menu.getByRole("menuitem", { name: "移出房间", exact: true }),
    ).toHaveCount(0);
  } finally {
    await context.close();
  }
});
