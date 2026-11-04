import { expect, test } from "bun:test";
import { FeatureCompatibility } from "../src/feature-compatibility";
import { currentFeatureProtocols } from "@cinegather/contracts";

test("future unknown feature policies do not prevent existing game and screen rules from updating", () => {
  const cache = new FeatureCompatibility(() => ({
    platform: "win32",
    version: "0.1.33",
    protocols: currentFeatureProtocols,
  }));
  expect(
    cache.accept({
      format: 1,
      revision: 3,
      rules: [
        { feature: "future.unrelated", protocol: 4, reason: "Future" },
        { feature: "screen.publish", protocol: 2, reason: "Only sharing" },
      ],
    }),
  ).toBe(true);
  expect(cache.issue("screen.publish")?.reason).toBe("Only sharing");
  expect(cache.issue("game.minecraft-java")).toBeUndefined();
  expect(
    cache.accept({
      format: 1,
      revision: 4,
      rules: Array.from({ length: 33 }, (_, n) => ({
        feature: "future." + n,
        protocol: 1,
        reason: "Oversized",
      })),
    }),
  ).toBe(false);
  expect(
    cache.accept({
      format: 1,
      revision: 4,
      rules: [
        {
          feature: "screen.publish",
          protocol: "bad",
          reason: "Invalid known rule",
        },
      ],
    }),
  ).toBe(false);
  expect(cache.issue("screen.publish")?.reason).toBe("Only sharing");
});
