import { expect, test } from "bun:test";
import {
  GAME_MAX_MEMBERS,
  GAME_LEASE_MS,
  GAME_RENEW_MS,
  gameCodeSchema,
  gameLocalAddressSchema,
  gameSessionInput,
  gameSnapshotSchema,
  currentFeatureProtocols,
} from "../src";

test("Minecraft addresses are loopback-only and cannot reveal or redirect to a remote endpoint", () => {
  expect(gameLocalAddressSchema.parse("127.0.0.1:25565")).toBe(
    "127.0.0.1:25565",
  );
  for (const value of [
    "localhost:25565",
    "0.0.0.0:25565",
    "82.156.152.21:25565",
    "remote.example:25565",
    "127.0.0.1:0",
    "127.0.0.1:65536",
    "127.0.0.1:25565/path",
  ])
    expect(gameLocalAddressSchema.safeParse(value).success).toBe(false);
});

test("independent game sessions have eight slots and do not accept voice-room state or user-selected tunnel endpoints", () => {
  expect(GAME_MAX_MEMBERS).toBe(8);
  expect(GAME_LEASE_MS).toBe(30000);
  expect(GAME_RENEW_MS).toBe(10000);
  expect(currentFeatureProtocols["game.minecraft-java"]).toEqual([2]);
  expect(
    gameSessionInput.parse({ name: "一起挖矿", game: "minecraft-java" }),
  ).toEqual({
    name: "一起挖矿",
    game: "minecraft-java",
  });
  for (const extra of [
    { roomId: crypto.randomUUID() },
    { maxMembers: 9 },
    { serverAddr: "example.com" },
  ])
    expect(gameSessionInput.safeParse({ name: "世界", ...extra }).success).toBe(
      false,
    );
  expect(gameCodeSchema.parse("abcd2345")).toBe("ABCD2345");
  expect(gameCodeSchema.safeParse("O0I1AAAA").success).toBe(false);
});

test("public game snapshots exclude native tunnel credentials and remote network addresses", () => {
  expect(
    gameSnapshotSchema.parse({
      session: null,
      self: null,
      members: [],
      requests: [],
      invitations: [],
    }),
  ).toEqual({
    session: null,
    self: null,
    members: [],
    requests: [],
    invitations: [],
  });
  for (const extra of [
    { tunnelSecret: "must-stay-native" },
    { relayAddress: "relay.example.com" },
    { roomId: crypto.randomUUID() },
  ])
    expect(
      gameSnapshotSchema.safeParse({
        session: null,
        self: null,
        members: [],
        requests: [],
        invitations: [],
        ...extra,
      }).success,
    ).toBe(false);
});
