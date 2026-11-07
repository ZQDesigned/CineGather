import { test, expect } from "bun:test";
import {
  validatePublicationScope,
  validateFeatureTargets,
} from "../../../tools/publishing/compatibility-publication";
test("global floors require explicit global scope and feature releases cannot alter global floors", () => {
  expect(() => validatePublicationScope(undefined, true)).toThrow();
  expect(() => validatePublicationScope("feature", true)).toThrow();
  expect(() => validatePublicationScope("global", true)).not.toThrow();
  expect(() => validatePublicationScope(undefined, false)).not.toThrow();
});
test("feature policies must target an available platform release without requiring unrelated platforms to update", () => {
  const p = {
    format: 1 as const,
    revision: 2,
    rules: [
      {
        feature: "screen.publish" as const,
        platforms: ["win32" as const],
        protocol: 2,
        reason: "共享升级",
        minimumVersions: { win32: "0.1.99" },
      },
    ],
  };
  expect(() =>
    validateFeatureTargets(p, { win32: { version: "0.1.98" } }),
  ).toThrow();
  expect(() =>
    validateFeatureTargets(p, { win32: { version: "0.1.99" } }),
  ).not.toThrow();
  const mobile = {
    format: 1 as const,
    revision: 3,
    rules: [
      {
        feature: "screen.publish" as const,
        platforms: ["android" as const],
        protocol: 2,
        reason: "共享升级",
        mobile: { android: { minimumRevisions: { r5: 10 } } },
      },
    ],
  };
  expect(() =>
    validateFeatureTargets(mobile, {
      android: { build: 5, runtimes: [{ runtime: "r6", revision: 10 }] },
    }),
  ).toThrow();
  expect(() =>
    validateFeatureTargets(mobile, {
      android: { build: 5, runtimes: [{ runtime: "r5", revision: 10 }] },
    }),
  ).not.toThrow();
});
test("publishing a feature policy is atomic and leaves signed global release metadata unchanged", async () => {
  const { mkdtemp, writeFile, readFile, rm } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const { generateKeyPairSync } = await import("node:crypto");
  const { signRelease } = await import("../../../tools/publishing/update-release");
  const { publishFeaturePolicy } = await import(
    "../../../tools/publishing/feature-policy-publish"
  );
  const dir = await mkdtemp(join(tmpdir(), "cg-feature-publish-")),
    keys = generateKeyPairSync("ed25519");
  const privateKey = keys.privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString(),
    publicKey = keys.publicKey
      .export({ type: "spki", format: "pem" })
      .toString();
  const release = {
    format: 1 as const,
    platform: "win32" as const,
    arch: "x64" as const,
    version: "0.1.99",
    minimumVersion: "0.1.32",
    publishedAt: new Date().toISOString(),
    notes: "test",
    artifact: {
      file: "CineGather-0.1.99-win-x64-setup.exe",
      size: 1,
      sha512: Buffer.alloc(64).toString("base64"),
    },
  };
  expect(() => signRelease(release, privateKey)).toThrow();
  expect(() => signRelease(release, privateKey, "feature")).toThrow();
  const raw = signRelease(release, privateKey, "global");
  const policy = {
    format: 1 as const,
    revision: 2,
    rules: [
      {
        feature: "screen.publish" as const,
        platforms: ["win32" as const],
        protocol: 2,
        reason: "仅共享更新",
        minimumVersions: { win32: "0.1.99" },
      },
    ],
  };
  try {
    await writeFile(join(dir, "win32-x64.json"), raw);
    await publishFeaturePolicy(policy, dir, publicKey);
    expect(
      JSON.parse(await readFile(join(dir, "feature-policy.json"), "utf8")),
    ).toEqual(policy);
    expect(await readFile(join(dir, "win32-x64.json"), "utf8")).toBe(raw);
    await expect(publishFeaturePolicy(policy, dir, publicKey)).rejects.toThrow(
      "monotonic",
    );
    await expect(
      publishFeaturePolicy(
        {
          ...policy,
          revision: 3,
          rules: [{ ...policy.rules[0]!, minimumVersions: { win32: "0.2.0" } }],
        },
        dir,
        publicKey,
      ),
    ).rejects.toThrow("not available");
    expect(
      JSON.parse(await readFile(join(dir, "feature-policy.json"), "utf8"))
        .revision,
    ).toBe(2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
