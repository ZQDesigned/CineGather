import { test, expect } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  FeaturePolicyStore,
  bindFeatureClient,
  requireFeature,
  requireRoomFeature,
} from "../src/modules/updates/feature-policy";
import {
  currentFeatureProtocols,
  emptyFeaturePolicy,
  type User,
} from "@cinegather/contracts";
test("atomic feature policies preserve last valid state and never silently downgrade after malformed replacement", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cg-feature-policy-")),
    file = join(dir, "feature-policy.json");
  const store = new FeaturePolicyStore(file);
  try {
    await store.refresh();
    expect(store.snapshot()).toEqual(emptyFeaturePolicy);
    await writeFile(
      file,
      JSON.stringify({
        format: 1,
        revision: 2,
        rules: [
          { feature: "screen.publish", protocol: 2, reason: "共享需要更新" },
        ],
      }),
    );
    await store.refresh();
    expect(store.snapshot().rules[0]?.protocol).toBe(2);
    await writeFile(file, "bad JSON");
    expect(await store.refresh()).toBe(false);
    expect(store.snapshot().revision).toBe(2);
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test("room protocols depend on actual configuration and only requested operations are denied", () => {
  const user = { id: crypto.randomUUID() } as User;
  bindFeatureClient(
    user,
    {
      platform: "win32",
      version: "0.1.32",
      protocols: { ...currentFeatureProtocols, "room.esports": [1] },
    },
    () => emptyFeaturePolicy,
  );
  expect(() =>
    requireRoomFeature(user, { mode: "standard", maxMembers: 5 }),
  ).not.toThrow();
  expect(() =>
    requireRoomFeature(user, {
      mode: "esports",
      esportsAdvanced: false,
      maxMembers: 20,
    }),
  ).not.toThrow();
  expect(() =>
    requireRoomFeature(user, {
      mode: "esports",
      esportsAdvanced: true,
      maxMembers: 20,
    }),
  ).toThrow();
  expect(() => requireFeature(user, "screen.publish")).not.toThrow();
});
test("legacy mobile clients receive a feature refusal without the HTTP426 that their old updater interprets globally", () => {
  const user = { id: crypto.randomUUID() } as User;
  const identity = {
    platform: "android" as const,
    protocols: currentFeatureProtocols,
    scopedUpdates: false,
  };
  bindFeatureClient(user, identity, () => ({
    format: 1,
    revision: 2,
    rules: [
      { feature: "screen.publish", protocol: 2, reason: "仅共享需要更新" },
    ],
  }));
  try {
    requireFeature(user, "screen.publish");
    throw Error("must reject");
  } catch (e) {
    expect((e as { getStatus(): number }).getStatus()).toBe(409);
  }
});
test("adding a room identifier preserves the negotiated legacy refusal status", () => {
  const user = { id: crypto.randomUUID() } as User;
  bindFeatureClient(
    user,
    {
      platform: "ios",
      protocols: { ...currentFeatureProtocols, "room.esports": [1] },
      scopedUpdates: false,
    },
    () => emptyFeaturePolicy,
  );
  try {
    requireRoomFeature(user, {
      id: crypto.randomUUID(),
      mode: "esports",
      maxMembers: 20,
      esportsAdvanced: true,
    });
    throw Error("must reject");
  } catch (e) {
    expect((e as { getStatus(): number }).getStatus()).toBe(409);
  }
});
