import { test, expect } from "bun:test";
import { hashRoomPassword, verifyRoomPassword } from "../src/passwords";

test("room password hashes use unique salts, match exactly and never store the password", async () => {
  const password = " 一起看123 ";
  const first = await hashRoomPassword(password);
  const second = await hashRoomPassword(password);
  expect(first).not.toBe(second);
  expect(first).not.toContain(password);
  expect(await verifyRoomPassword(password, first)).toBe(true);
  expect(await verifyRoomPassword(password.trim(), first)).toBe(false);
  expect(await verifyRoomPassword("wrong", first)).toBe(false);
  expect(await verifyRoomPassword(password, "invalid")).toBe(false);
});
