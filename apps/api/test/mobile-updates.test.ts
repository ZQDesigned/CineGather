import { test, expect } from "bun:test";
import { mobileUpdateIndexSchema } from "@cinegather/contracts";
import {
  selectMobilePolicy,
  mobileCompatibilityFailure,
} from "../src/mobile-updates";
const index = () =>
  mobileUpdateIndexSchema.parse({
    format: 1,
    platform: "android",
    channel: "stable",
    policyVersion: 3,
    native: {
      version: "0.2.0",
      build: 4,
      minimumBuild: 2,
      url: "https://cgplat.zqdesigned.city/downloads/mobile.apk",
      notes: "原生更新",
    },
    runtimes: [
      {
        runtime: "native-v1",
        revision: 5,
        minimumRevision: 3,
        version: "0.2.1",
        updateId: "b4d62da7-258c-4ad7-957b-4c0d713c92f4",
        createdAt: "2026-10-31T00:00:00.000Z",
        notes: "热更新",
      },
    ],
  });
test("native and OTA compatibility floors stay independent and preserve cleanup", () => {
  const p = selectMobilePolicy(index(), "native-v1");
  expect(p.ota?.revision).toBe(5);
  expect(selectMobilePolicy(index(), "other-runtime").ota).toBeUndefined();
  expect(
    mobileCompatibilityFailure(
      "GET",
      "/api/v1/me",
      { build: "2", runtime: "native-v1", revision: "3" },
      p,
    ),
  ).toBeUndefined();
  expect(
    mobileCompatibilityFailure(
      "GET",
      "/api/v1/me",
      { build: "1", runtime: "native-v1", revision: "5" },
      p,
    )?.kind,
  ).toBe("package");
  expect(
    mobileCompatibilityFailure(
      "GET",
      "/api/v1/me",
      { build: "2", runtime: "native-v1", revision: "2" },
      p,
    )?.kind,
  ).toBe("hot");
  expect(mobileCompatibilityFailure("GET", "/api/v1/me", {}, p)?.kind).toBe(
    "package",
  );
  for (const [method, path] of [
    ["GET", "/api/v1/mobile-updates/policy"],
    ["GET", "/api/v1/mobile-updates/manifest"],
    ["POST", "/api/v1/rooms/id/leave"],
    ["DELETE", "/api/v1/rooms/id/share-lease"],
    ["DELETE", "/api/v1/session"],
  ])
    expect(mobileCompatibilityFailure(method!, path!, {}, p)).toBeUndefined();
});
test("release validation rejects unsafe URLs, impossible floors and duplicate runtimes", () => {
  const p = index();
  expect(() =>
    mobileUpdateIndexSchema.parse({
      ...p,
      native: { ...p.native, minimumBuild: 5 },
    }),
  ).toThrow();
  expect(() =>
    mobileUpdateIndexSchema.parse({
      ...p,
      native: { ...p.native, url: "javascript:alert(1)" },
    }),
  ).toThrow();
  expect(() =>
    mobileUpdateIndexSchema.parse({
      ...p,
      runtimes: [...p.runtimes, ...p.runtimes],
    }),
  ).toThrow();
  expect(() =>
    mobileUpdateIndexSchema.parse({
      ...p,
      runtimes: [{ ...p.runtimes[0], runtime: "../secret" }],
    }),
  ).toThrow();
  expect(() =>
    mobileUpdateIndexSchema.parse({
      ...p,
      runtimes: [{ ...p.runtimes[0], minimumRevision: 6 }],
    }),
  ).toThrow();
});

test("self-hosted Expo server selects exact runtime and refuses traversal or missing signatures", async () => {
  const { MobileUpdateStore } = await import("../src/mobile-update-store");
  const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const root = await mkdtemp("/tmp/cg-mobile-updates-");
  try {
    await mkdir(join(root, "mobile/stable"), { recursive: true });
    await writeFile(
      join(root, "mobile/stable/android.json"),
      JSON.stringify(index()),
    );
    const store = new MobileUpdateStore(root);
    expect(store.policy("android", "stable", "native-v1")?.ota?.revision).toBe(
      5,
    );
    expect(store.policy("ios", "stable", "native-v1")).toBeUndefined();
    expect(() =>
      store.policy("android", "../../secret", "native-v1"),
    ).toThrow();
    expect(() => store.manifest("android", "stable", "native-v1")).toThrow();
    const manifest = {
      id: index().runtimes[0]!.updateId,
      runtimeVersion: "native-v1",
      createdAt: "2026-10-31T00:00:00.000Z",
      launchAsset: {
        key: "test",
        hash: "a".repeat(43),
        contentType: "application/javascript",
        url:
          "https://cgplat.zqdesigned.city/api/v1/mobile-updates/assets/" +
          "a".repeat(64),
      },
      assets: [],
      metadata: {},
      extra: {},
    };
    await mkdir(join(root, "mobile/manifests"), { recursive: true });
    await writeFile(
      join(root, "mobile/manifests", manifest.id + ".json"),
      JSON.stringify({
        manifest: JSON.stringify(manifest),
        signature: Buffer.alloc(384).toString("base64"),
      }),
    );
    expect(
      store.manifest("android", "stable", "other-runtime"),
    ).toBeUndefined();
    expect(store.manifest("android", "stable", "native-v1")?.manifest).toBe(
      JSON.stringify(manifest),
    );
    expect(() => store.assetPath("../android.json")).toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
