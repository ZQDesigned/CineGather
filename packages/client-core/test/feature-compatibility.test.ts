import { test, expect } from "bun:test";
import { FeatureCompatibility } from "../src/feature-compatibility";
import { FeatureUpdateError } from "@cinegather/api-client";
import { currentFeatureProtocols } from "@cinegather/contracts";
test("receiving policy is silent; only requested features throw and invalid or stale policies cannot clear restrictions", async () => {
  let changes = 0;
  const gate = new FeatureCompatibility(
    () => ({
      platform: "win32",
      version: "0.1.32",
      protocols: currentFeatureProtocols,
    }),
    () => changes++,
  );
  expect(
    gate.accept({
      format: 1,
      revision: 2,
      rules: [{ feature: "screen.publish", protocol: 2, reason: "共享需升级" }],
    }),
  ).toBe(true);
  expect(changes).toBe(1);
  expect(() => gate.require("room.standard")).not.toThrow();
  expect(() => gate.require("screen.publish")).toThrow(FeatureUpdateError);
  expect(gate.accept({ format: 1, revision: 1, rules: [] })).toBe(false);
  expect(
    gate.accept({ format: 1, revision: 3, rules: [{ feature: "oops" }] }),
  ).toBe(false);
  expect(() => gate.require("screen.publish")).toThrow();
  expect(gate.accept({ format: 1, revision: 3, rules: [] })).toBe(true);
  expect(() => gate.require("screen.publish")).not.toThrow();
});
test("missing legacy endpoints and network failures keep the latest policy without raising a global update", async () => {
  const gate = new FeatureCompatibility(() => ({
    platform: "web",
    version: "0.1.32",
    protocols: currentFeatureProtocols,
  }));
  expect(
    await gate.refresh(
      "http://fixture.invalid",
      async () => new Response("", { status: 404 }),
    ),
  ).toBe(false);
  gate.accept({
    format: 1,
    revision: 2,
    rules: [{ feature: "screen.watch", protocol: 2, reason: "观看需刷新" }],
  });
  expect(
    await gate.refresh("http://fixture.invalid", async () => {
      throw Error("offline");
    }),
  ).toBe(false);
  expect(gate.issue("screen.watch")?.updateKind).toBe("reload");
  expect(gate.issue("room.standard")).toBeUndefined();
});
