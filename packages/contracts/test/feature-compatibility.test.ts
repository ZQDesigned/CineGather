import { test, expect } from "bun:test";
import {
  featurePolicySchema,
  featureCompatibilityFailure,
  currentFeatureProtocols,
  parseFeatureProtocols,
} from "../src";
const policy = featurePolicySchema.parse({
  format: 1,
  revision: 1,
  rules: [
    {
      feature: "room.esports",
      protocol: 2,
      reason: "赛事功能已升级",
      minimumVersions: { win32: "0.1.99" },
    },
  ],
});
test("feature requirements do not affect unrelated features or compatible base room configurations", () => {
  const old = {
    platform: "win32" as const,
    version: "0.1.32",
    protocols: { ...currentFeatureProtocols, "room.esports": [1] },
  };
  expect(
    featureCompatibilityFailure("room.standard", old, policy),
  ).toBeUndefined();
  expect(
    featureCompatibilityFailure("room.esports", old, policy),
  ).toMatchObject({
    scope: "feature",
    feature: "room.esports",
    protocol: 2,
    minimumVersion: "0.1.99",
    updateKind: "desktop",
  });
  const empty = featurePolicySchema.parse({
    format: 1,
    revision: 1,
    rules: [],
  });
  expect(
    featureCompatibilityFailure("room.esports", old, empty, 1),
  ).toBeUndefined();
  expect(
    featureCompatibilityFailure("room.esports", old, empty, 2),
  ).toBeDefined();
  expect(
    featureCompatibilityFailure("screen.watch", old, policy),
  ).toBeUndefined();
});
test("protocol support is an explicit set, and mobile native floors and OTA revisions are independent", () => {
  const p = featurePolicySchema.parse({
    format: 1,
    revision: 2,
    rules: [
      {
        feature: "screen.publish",
        protocol: 2,
        reason: "共享升级",
        mobile: { android: { minimumBuild: 5, minimumRevisions: { r5: 10 } } },
      },
    ],
  });
  const identity = {
    platform: "android" as const,
    version: "0.2.0",
    build: 5,
    runtime: "r5",
    revision: 9,
    protocols: currentFeatureProtocols,
  };
  expect(
    featureCompatibilityFailure("screen.publish", identity, p)?.updateKind,
  ).toBe("hot");
  expect(
    featureCompatibilityFailure("screen.publish", { ...identity, build: 4 }, p)
      ?.updateKind,
  ).toBe("package");
  expect(
    featureCompatibilityFailure(
      "screen.publish",
      { ...identity, runtime: "r6" },
      p,
    )?.updateKind,
  ).toBe("package");
  expect(
    featureCompatibilityFailure(
      "screen.publish",
      {
        ...identity,
        revision: 10,
        protocols: { ...currentFeatureProtocols, "screen.publish": [2] },
      },
      p,
    ),
  ).toBeUndefined();
  expect(
    featureCompatibilityFailure(
      "screen.publish",
      {
        ...identity,
        revision: 10,
        protocols: { ...currentFeatureProtocols, "screen.publish": [3] },
      },
      p,
    ),
  ).toBeDefined();
});
test("legacy declarations retain baseline behavior, explicit malformed protocol headers cannot downgrade to legacy", () => {
  expect(
    parseFeatureProtocols(undefined, "esports-v1")["room.esports"],
  ).toEqual([1]);
  expect(
    parseFeatureProtocols(undefined, "esports-v1,esports-v2")["room.esports"],
  ).toEqual([1, 2]);
  expect(parseFeatureProtocols(undefined)["screen.publish"]).toEqual([1]);
  expect(parseFeatureProtocols("{bad", "esports-v2")).toEqual({});
  expect(() =>
    featurePolicySchema.parse({
      ...policy,
      rules: [...policy.rules, ...policy.rules],
    }),
  ).toThrow();
});
test("new protocol declarations can include unknown future features without hiding known support", () => {
  expect(
    parseFeatureProtocols(
      JSON.stringify({ ...currentFeatureProtocols, "future.feature": [3] }),
    )["room.standard"],
  ).toEqual([1]);
  const scoped = featurePolicySchema.parse({
    format: 1,
    revision: 2,
    rules: [
      {
        feature: "screen.publish",
        platforms: ["win32"],
        protocol: 1,
        reason: "原生组件需要更新",
        minimumVersions: { win32: "0.1.99" },
      },
    ],
  });
  expect(
    featureCompatibilityFailure(
      "screen.publish",
      { protocols: currentFeatureProtocols },
      scoped,
    ),
  ).toBeDefined();
  expect(
    featureCompatibilityFailure(
      "screen.publish",
      { platform: "ios", version: "0.2.0", protocols: currentFeatureProtocols },
      scoped,
    ),
  ).toBeUndefined();
});
test("an advanced-room release floor does not block a compatible base configuration", () => {
  const policy = {
    format: 1 as const,
    revision: 7,
    rules: [
      {
        feature: "room.esports" as const,
        protocol: 2,
        appliesFromProtocol: 2,
        reason: "教练功能需升级",
        minimumVersions: { win32: "0.1.99" },
      },
    ],
  };
  const identity = {
    platform: "win32" as const,
    version: "0.1.32",
    protocols: currentFeatureProtocols,
  };
  expect(
    featureCompatibilityFailure(
      "room.esports",
      identity,
      featurePolicySchema.parse(policy),
      1,
    ),
  ).toBeUndefined();
  expect(
    featureCompatibilityFailure(
      "room.esports",
      identity,
      featurePolicySchema.parse(policy),
      2,
    ),
  ).toMatchObject({ minimumVersion: "0.1.99" });
});
