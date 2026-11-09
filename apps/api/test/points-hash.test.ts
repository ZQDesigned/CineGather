import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { pointsEntryHash } from "../src/modules/points/audit-hash";
test("audit digests use fixed key ordering rather than machine locale or object insertion order", () => {
  const payload = { facts: { z: 1, A: 2, a: 3, é: 4 }, foo: "bar" };
  const canonical = '{"facts":{"A":2,"a":3,"z":1,"é":4},"foo":"bar"}';
  expect(pointsEntryHash(payload)).toBe(
    createHash("sha256").update(canonical).digest("hex"),
  );
  expect(pointsEntryHash(payload)).toBe(
    pointsEntryHash({ foo: "bar", facts: { é: 4, a: 3, A: 2, z: 1 } }),
  );
});
