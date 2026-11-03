import { expect, test } from "bun:test";
import {
  esportsSeatSchema,
  esportsChannelName,
  esportsMediaRights,
  esportsSeatLimit,
} from "../src/esports";
import { roomInput, MAX_ROOM_MEMBERS, DEFAULT_ROOM_MEMBER_LIMIT } from "../src";

test("esports seats carry stable group ids and distinct director/audience seats", () => {
  expect(esportsSeatSchema.parse({ kind: "player", team: "a" })).toEqual({
    kind: "player",
    team: "a",
  });
  expect(esportsSeatSchema.safeParse({ kind: "player" }).success).toBe(false);
  expect(
    esportsSeatSchema.safeParse({ kind: "player", team: "c" }).success,
  ).toBe(true);
  expect(esportsSeatLimit({ kind: "player", team: "c" })).toBe(0);
  expect(
    esportsSeatSchema.safeParse({ kind: "director", team: "a" }).success,
  ).toBe(false);
  expect(esportsSeatLimit({ kind: "player", team: "b" })).toBe(5);
  expect(esportsSeatLimit({ kind: "director" })).toBe(5);
  expect(esportsSeatLimit({ kind: "audience" })).toBe(5);
});

test("esports uses fixed seats independently of the ordinary room entitlement ceiling", () => {
  expect(MAX_ROOM_MEMBERS).toBe(25);
  expect(DEFAULT_ROOM_MEMBER_LIMIT).toBe(10);
  expect(roomInput.parse({ name: "ordinary" }).maxMembers).toBe(5);
  expect(
    roomInput.safeParse({ name: "ordinary", maxMembers: 26 }).success,
  ).toBe(false);
  expect(roomInput.parse({ name: "match", mode: "esports" }).maxMembers).toBe(
    20,
  );
  expect(
    roomInput.safeParse({ name: "match", mode: "esports", maxMembers: 10 })
      .success,
  ).toBe(false);
});

test("voice publication stays in the actor seat, team monitoring is read-only, players cannot view video", () => {
  const player = { kind: "player", team: "a" } as const;
  expect(esportsMediaRights(player, { kind: "team", team: "a" })).toEqual({
    publish: true,
    subscribe: true,
  });
  expect(esportsMediaRights(player, { kind: "team", team: "b" })).toEqual({
    publish: false,
    subscribe: false,
  });
  expect(esportsMediaRights(player, { kind: "director" })).toEqual({
    publish: false,
    subscribe: false,
  });
  expect(esportsMediaRights(player, { kind: "audience" })).toEqual({
    publish: false,
    subscribe: false,
  });
  expect(
    esportsMediaRights(player, { kind: "video", publicationId: "x" }, false),
  ).toEqual({ publish: false, subscribe: false });
  expect(
    esportsMediaRights(player, { kind: "video", publicationId: "x" }, true),
  ).toEqual({ publish: true, subscribe: false });
  expect(
    esportsMediaRights({ kind: "director" }, { kind: "team", team: "b" }),
  ).toEqual({ publish: false, subscribe: true });
  expect(
    esportsMediaRights({ kind: "director" }, { kind: "director" }),
  ).toEqual({ publish: true, subscribe: true });
  expect(
    esportsMediaRights({ kind: "director" }, { kind: "audience" }),
  ).toEqual({ publish: false, subscribe: false });
  expect(
    esportsMediaRights({ kind: "audience" }, { kind: "team", team: "a" }),
  ).toEqual({ publish: false, subscribe: true });
  expect(
    esportsMediaRights({ kind: "audience" }, { kind: "director" }),
  ).toEqual({ publish: false, subscribe: false });
  expect(
    esportsMediaRights({ kind: "audience" }, { kind: "audience" }),
  ).toEqual({ publish: true, subscribe: true });
  expect(
    esportsMediaRights(
      { kind: "audience" },
      { kind: "video", publicationId: "x" },
    ),
  ).toEqual({ publish: false, subscribe: true });
});

test("physical channels do not collide across parent rooms, teams or independent player publications", () => {
  const roomA = "11111111-1111-4111-8111-111111111111",
    roomB = "22222222-2222-4222-8222-222222222222";
  const pubA = "33333333-3333-4333-8333-333333333333",
    pubB = "44444444-4444-4444-8444-444444444444";
  expect(esportsChannelName(roomA, { kind: "team", team: "a" })).not.toBe(
    esportsChannelName(roomA, { kind: "team", team: "b" }),
  );
  expect(esportsChannelName(roomA, { kind: "director" })).not.toBe(
    esportsChannelName(roomB, { kind: "director" }),
  );
  expect(
    esportsChannelName(roomA, { kind: "video", publicationId: pubA }),
  ).not.toBe(esportsChannelName(roomA, { kind: "video", publicationId: pubB }));
  expect(() =>
    esportsChannelName(roomA, { kind: "video", publicationId: "../other" }),
  ).toThrow();
});
