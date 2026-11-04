import { beforeAll, afterAll, expect, test } from "bun:test";
import { createApp } from "../../apps/api/src/app";
import {
  createDatabase,
  users,
  rooms,
  members,
  credentials,
  auditLogs,
  idempotency,
  esportsSeats,
  roomMemberPermissions,
} from "@cinegather/database";
import { eq, inArray } from "drizzle-orm";
import { defaultEsportsConfiguration } from "@cinegather/contracts";
import { admitMediaToken } from "../../apps/api/src/esports-admission";
const { db, pool } = createDatabase(process.env.DATABASE_URL!);
const ids: string[] = [];
let app: Awaited<ReturnType<typeof createApp>>, base: string;
async function req(
  path: string,
  token: string | undefined,
  body?: unknown,
  method = body ? "POST" : "GET",
  features = "esports-v1,esports-v2",
) {
  const r = await fetch(base + "/api/v1" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-CineGather-Platform": "web",
      "X-CineGather-Features": features,
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
}
async function person() {
  const r = await req("/accounts/register", undefined, {
    username: "dyn_" + crypto.randomUUID().replaceAll("-", "").slice(0, 20),
    displayName: "动态赛事",
    password: "Dynamic esports 123!",
  });
  expect(r.status).toBe(201);
  ids.push(r.body.user.id);
  return { id: r.body.user.id as string, token: r.body.sessionToken as string };
}
async function fixture() {
  const owner = await person();
  await db
    .update(users)
    .set({ esportsRoomsEnabled: true })
    .where(eq(users.id, owner.id));
  const r = await req("/rooms", owner.token, {
    name: "动态分组",
    mode: "esports",
  });
  expect(r.status).toBe(201);
  const id = r.body.id as string;
  expect((await req(`/rooms/${id}/join`, owner.token, {})).status).toBe(201);
  return { owner, id, url: `/rooms/${id}/esports` };
}
beforeAll(async () => {
  app = await createApp();
  await app.listen(0, "127.0.0.1");
  base = await app.getUrl();
});
afterAll(async () => {
  await app?.close();
  const { closeEsports } = await import("../../apps/api/src/esports");
  for (const r of await db
    .select()
    .from(rooms)
    .where(inArray(rooms.ownerUserId, ids)))
    await db.transaction((tx) => closeEsports(tx, r.id));
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
test("owner configures six groups/52 seats atomically and legacy clients cannot see advanced rooms", async () => {
  const { owner, id, url } = await fixture(),
    other = await person();
  await req(`/rooms/${id}/join`, other.token, {});
  const configuration = {
    groups: Array.from({ length: 6 }, (_, i) => ({
      id: "team-" + i,
      name: "战队" + i,
      playerSeats: 5,
      coachSeats: 2,
    })),
    tacticalPauseSeconds: 60,
  };
  expect(
    (
      await req(
        url + "/settings",
        other.token,
        { revision: 1, configuration },
        "PATCH",
      )
    ).status,
  ).toBe(403);
  const saved = await req(
    url + "/settings",
    owner.token,
    { revision: 1, configuration },
    "PATCH",
  );
  expect(saved.status).toBe(200);
  expect(saved.body.configuration.groups).toHaveLength(6);
  expect(saved.body.configurationRevision).toBe(2);
  expect((await req(`/rooms/${id}`, owner.token)).body.maxMembers).toBe(52);
  expect(
    (
      await req(
        url + "/settings",
        owner.token,
        { revision: 1, configuration },
        "PATCH",
      )
    ).status,
  ).toBe(409);
  expect(
    (await req(`/rooms/${id}`, owner.token, undefined, "GET", "esports-v1"))
      .status,
  ).toBe(409);
  expect(
    (
      await req("/rooms", owner.token, undefined, "GET", "esports-v1")
    ).body.items.some((r: { id: string }) => r.id === id),
  ).toBe(false);
});
test("coach watches own team only, manual voice persists through timeout, and old voice grants cannot reconnect", async () => {
  const { owner, id, url } = await fixture(),
    coach = await person(),
    player = await person(),
    other = await person();
  for (const p of [coach, player, other])
    expect((await req(`/rooms/${id}/join`, p.token, {})).status).toBe(201);
  const configuration = {
    ...defaultEsportsConfiguration,
    groups: defaultEsportsConfiguration.groups.map((g) => ({
      ...g,
      coachSeats: 2,
    })),
    tacticalPauseSeconds: 1,
  };
  expect(
    (
      await req(
        url + "/settings",
        owner.token,
        { revision: 1, configuration },
        "PATCH",
      )
    ).status,
  ).toBe(200);
  for (const [p, seat] of [
    [coach, { kind: "coach", team: "a" }],
    [player, { kind: "player", team: "a" }],
    [other, { kind: "player", team: "b" }],
  ] as const)
    expect(
      (await req(url + `/members/${p.id}/seat`, owner.token, seat)).status,
    ).toBe(201);
  const own = (
      await req(url + "/share-lease", player.token, { quality: "cinema" })
    ).body,
    foreign = (
      await req(url + "/share-lease", other.token, { quality: "cinema" })
    ).body;
  expect(
    (await req(url + "/share-lease", coach.token, { quality: "cinema" }))
      .status,
  ).toBe(403);
  let s = (await req(url, coach.token)).body;
  expect(s.self.microphoneAllowed).toBe(false);
  expect(
    (
      await req(url + "/watch", coach.token, {
        action: "select",
        publicationId: foreign.publicationId,
        revision: s.watch.revision,
      })
    ).status,
  ).toBe(403);
  const warm = await req(url + "/watch", coach.token, {
    action: "select",
    publicationId: own.publicationId,
    revision: s.watch.revision,
  });
  expect(warm.status).toBe(201);
  const commit = await req(url + "/watch", coach.token, {
    action: "commit",
    publicationId: own.publicationId,
    revision: warm.body.watch.revision,
  });
  expect(commit.status).toBe(201);
  expect(commit.body.watch.monitorTeam).toBeNull();
  expect(
    (await req(url + "/tactical-pause", coach.token, { active: true })).status,
  ).toBe(403);
  expect(
    (await req(url + "/tactical-pause", owner.token, { active: true })).status,
  ).toBe(201);
  s = (await req(url, coach.token)).body;
  expect(s.self.microphoneAllowed).toBe(true);
  const connection = await req(url + "/connection", coach.token, {
    channel: { kind: "team", team: "a" },
    seatRevision: s.self.revision,
  });
  expect(connection.status).toBe(201);
  await admitMediaToken(connection.body.token);
  expect(
    (await req(url + "/coach-voice", owner.token, { mode: "open" })).status,
  ).toBe(201);
  await new Promise((r) => setTimeout(r, 1100));
  s = (await req(url, coach.token)).body;
  expect(s.self.microphoneAllowed).toBe(true);
  expect(s.tacticalPauseUntil).toBeNull();
  await admitMediaToken(connection.body.token);
  await db.insert(roomMemberPermissions).values({
    roomId: id,
    userId: coach.id,
    microphoneAllowed: false,
    sharingAllowed: true,
  });
  expect((await req(url, coach.token)).body.self.microphoneAllowed).toBe(false);
  await expect(admitMediaToken(connection.body.token)).rejects.toThrow();
  await db
    .update(roomMemberPermissions)
    .set({ microphoneAllowed: true })
    .where(eq(roomMemberPermissions.userId, coach.id));
  expect((await req(url, coach.token)).body.self.microphoneAllowed).toBe(true);
  expect(
    (await req(url + "/coach-voice", owner.token, { mode: "closed" })).status,
  ).toBe(201);
  await expect(admitMediaToken(connection.body.token)).rejects.toThrow();
  s = (await req(url, coach.token)).body;
  expect(s.self.microphoneAllowed).toBe(false);
  expect(s.watch.current).toBe(own.publicationId);
  await req(url + "/coach-voice", owner.token, { mode: "auto" });
  await req(url + "/tactical-pause", owner.token, { active: true });
  await new Promise((r) => setTimeout(r, 2200));
  expect(
    (await db.select().from(rooms).where(eq(rooms.id, id)))[0]!
      .tacticalPauseUntil,
  ).toBeNull();
  expect((await req(url, coach.token)).body.self.microphoneAllowed).toBe(false);
});
test("occupied or reconnecting seats block shrinking and deleting their group", async () => {
  const { owner, id, url } = await fixture(),
    player = await person();
  await req(`/rooms/${id}/join`, player.token, {});
  await req(url + `/members/${player.id}/seat`, owner.token, {
    kind: "player",
    team: "a",
  });
  const configuration = {
    ...defaultEsportsConfiguration,
    groups: [defaultEsportsConfiguration.groups[1]!],
  };
  const save = () =>
    req(
      url + "/settings",
      owner.token,
      { revision: 1, configuration },
      "PATCH",
    );
  expect((await save()).status).toBe(409);
  await db
    .update(esportsSeats)
    .set({ reservedUntil: new Date(Date.now() + 60000) })
    .where(eq(esportsSeats.userId, player.id));
  expect((await save()).status).toBe(409);
  const expired = new Date(Date.now() - 1000);
  await db
    .update(esportsSeats)
    .set({ reservedUntil: expired })
    .where(eq(esportsSeats.userId, player.id));
  expect((await save()).status).toBe(200);
  expect((await req(`/rooms/${id}`, owner.token)).body.maxMembers).toBe(15);
});
test("expired legacy reservations do not block adopting advanced features", async () => {
  const { owner, id, url } = await fixture(),
    legacy = await person();
  expect(
    (await req(`/rooms/${id}/join`, legacy.token, {}, "POST", "esports-v1"))
      .status,
  ).toBe(201);
  await req(url + `/members/${legacy.id}/seat`, owner.token, {
    kind: "player",
    team: "a",
  });
  const update = () =>
    req(
      url + "/settings",
      owner.token,
      { revision: 1, configuration: defaultEsportsConfiguration },
      "PATCH",
    );
  expect((await update()).status).toBe(409);
  await db
    .update(esportsSeats)
    .set({ reservedUntil: new Date(Date.now() - 1000) })
    .where(eq(esportsSeats.userId, legacy.id));
  expect((await update()).status).toBe(200);
});
