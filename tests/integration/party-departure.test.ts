import { beforeAll, afterAll, test, expect } from "bun:test";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { createApp } from "../../apps/api/src/app";
import { db, hash } from "../../apps/api/src/core/context";
import { media } from "../../apps/api/src/modules/media/media";
import {
  users,
  credentials,
  rooms,
  members,
  roomSessions,
  leases,
  roomActivities,
  auditLogs,
  pointsLedger,
} from "@cinegather/database";
import { protocolHeaders } from "@cinegather/contracts";
import type { PartyGame } from "../../apps/api/src/modules/party/party-game";
const people: string[] = [],
  roomIds: string[] = [];
let app: Awaited<ReturnType<typeof createApp>>, origin: string;
beforeAll(async () => {
  if (!process.env.DATABASE_URL?.includes("activities_tests"))
    throw Error("isolated local database required");
  app = await createApp();
  await app.listen(0, "127.0.0.1");
  origin = await app.getUrl();
});
afterAll(async () => {
  await app.close();
  if (people.length) {
    await db.delete(auditLogs).where(inArray(auditLogs.actorId, people));
    await db.delete(rooms).where(inArray(rooms.id, roomIds));
    await db.delete(users).where(inArray(users.id, people));
  }
});
async function fixture(count = 3) {
  const roomId = randomUUID();
  roomIds.push(roomId);
  const players = Array.from({ length: count }, () => ({
    id: randomUUID(),
    token: randomUUID(),
    credential: randomUUID(),
  }));
  for (const p of players) {
    people.push(p.id);
    await db
      .insert(users)
      .values({
        id: p.id,
        username: "depart_" + p.id.slice(0, 8),
        displayName: "退房验证",
        passwordHash: "fixture",
      });
    await db
      .insert(credentials)
      .values({
        id: p.credential,
        userId: p.id,
        kind: "account",
        secretHash: hash(p.token),
        expiresAt: new Date(Date.now() + 3600000),
      });
  }
  await db
    .insert(rooms)
    .values({
      id: roomId,
      code: roomId.replaceAll("-", "").slice(0, 8).toUpperCase(),
      name: "退房回合验证",
      ownerUserId: players[0]!.id,
      maxMembers: 5,
    });
  await db.insert(leases).values({ roomId });
  for (const p of players) {
    await db
      .insert(members)
      .values({
        roomId,
        userId: p.id,
        role: p === players[0] ? "owner" : "member",
        admittedUntil: new Date(Date.now() + 120000),
      });
    await db
      .insert(roomSessions)
      .values({
        roomId,
        userId: p.id,
        credentialId: p.credential,
        admittedUntil: new Date(Date.now() + 120000),
      });
  }
  async function call(index: number, path: string, body?: unknown) {
    const r = await fetch(origin + "/api/v1" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: "Bearer " + players[index]!.token,
        "Content-Type": "application/json",
        ...protocolHeaders,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await r.json();
    expect(r.ok).toBe(true);
    return data;
  }
  const path = `/rooms/${roomId}/activity`;
  let generation = 0;
  async function start(kind: "draw" | "quiz") {
    generation = (
      await call(0, path, { type: "start", target: kind, generation: 0 })
    ).generation;
    for (let i = 0; i < count; i++)
      await party(i, { type: "ready", ready: true });
    await party(0, { type: "start" });
    if (kind === "draw") {
      await party(0, { type: "choose", index: 0 });
      await call(0, path, {
        type: "board",
        generation,
        operation: {
          type: "put",
          element: {
            id: randomUUID(),
            kind: "path",
            x: 0,
            y: 0,
            width: 30,
            height: 30,
            points: [
              [0, 0],
              [30, 30],
            ],
            color: "#112233",
            strokeWidth: 3,
          },
        },
      });
    }
  }
  const party = (i: number, action: unknown) =>
    call(i, path, { type: "party", generation, action });
  async function game() {
    const [r] = await db
      .select()
      .from(roomActivities)
      .where(eq(roomActivities.roomId, roomId));
    return (r!.state as { game: PartyGame }).game;
  }
  async function leave(i: number) {
    const remove = media.remove,
      participants = media.participants;
    media.remove = async (id, ...args) =>
      id === roomId ? undefined : remove.call(media, id, ...args);
    media.participants = async (id, ...args) =>
      id === roomId ? [] : participants.call(media, id, ...args);
    try {
      await call(i, `/rooms/${roomId}/leave`, {});
    } finally {
      media.remove = remove;
      media.participants = participants;
    }
  }
  return { roomId, players, call, path, party, start, game, leave };
}
for (const mode of ["draw", "quiz"] as const)
  for (const departure of ["leave", "expire"] as const) {
    test(`departure ${mode}/${departure}: the last unsolved player's absence completes the round and settles once`, async () => {
      const f = await fixture();
      await f.start(mode);
      const before = await f.game();
      for (const i of mode === "draw" ? [1] : [0, 1])
        await f.party(i, {
          type: "guess",
          answer: before.word!.answer,
          roundId: before.roundId,
        });
      if (departure === "leave") await f.leave(2);
      else {
        await db
          .update(roomSessions)
          .set({ admittedUntil: new Date(0) })
          .where(
            and(
              eq(roomSessions.roomId, f.roomId),
              eq(roomSessions.userId, f.players[2]!.id),
            ),
          );
        await db
          .update(members)
          .set({ admittedUntil: new Date(0) })
          .where(
            and(
              eq(members.roomId, f.roomId),
              eq(members.userId, f.players[2]!.id),
            ),
          );
      }
      const snapshot = await f.call(0, f.path);
      expect(snapshot.game.phase).toBe("results");
      expect(
        snapshot.game.players.some(
          (p: { id: string }) => p.id === f.players[2]!.id,
        ),
      ).toBe(false);
      const done = await f.game();
      expect(done.roundCompleted).toBe(true);
      for (let i = 0; i < 3; i++) await f.call(0, f.path);
      const entries = await db
        .select()
        .from(pointsLedger)
        .where(eq(pointsLedger.roomId, f.roomId));
      expect(entries.filter((e) => e.reward === "painter")).toHaveLength(
        mode === "draw" ? 1 : 0,
      );
      if (mode === "draw")
        expect(entries.find((e) => e.reward === "painter")!.amount).toBe(5);
      expect((await f.game()).deadline).toBe(done.deadline);
    });
  }
test("departure of the paused drawer ends an insufficient match, transfers control and gives no painter reward", async () => {
  const f = await fixture(2);
  await f.start("draw");
  await f.party(0, { type: "pause" });
  await f.leave(0);
  const s = await f.call(1, f.path);
  expect(s.ownerId).toBe(f.players[1]!.id);
  expect(s.game.phase).toBe("finished");
  expect(s.game.players).toHaveLength(1);
  const g = await f.game();
  expect(g.pausedPhase).toBeUndefined();
  expect(g.roundCompleted).toBe(false);
  expect(
    await db
      .select()
      .from(pointsLedger)
      .where(eq(pointsLedger.roomId, f.roomId)),
  ).toHaveLength(0);
});
