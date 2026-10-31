import { expect, test } from "bun:test";
import { zipSync, strToU8 } from "fflate";
import { createHash } from "node:crypto";
import {
  readNativeBaseline,
  withNativeBaseline,
} from "../../../tools/mobile-native-baseline";
function config() {
  return {
    version: "0.1.0",
    sdkVersion: "57.0.0",
    scheme: "cinegather",
    plugins: ["expo-router"],
    android: { package: "city.zqdesigned.cinegather.mobile", versionCode: 3 },
    ios: {
      bundleIdentifier: "city.zqdesigned.cinegather.mobile",
      buildNumber: "3",
    },
    updates: {
      url: "https://cgplat.zqdesigned.city/api/v1/mobile-updates/manifest",
      codeSigningMetadata: { keyid: "main", alg: "rsa-v1_5-sha256" },
    },
    extra: {
      mobileUpdate: { revision: 1, version: "0.1.0", channel: "stable" },
    },
  };
}
function fixture(platform: "android" | "ios") {
  const prefix = platform === "android" ? "assets/" : "Payload/app.app/";
  const bytes = zipSync({
    [prefix +
    (platform === "android" ? "app.config" : "EXConstants.bundle/app.config")]:
      strToU8(JSON.stringify(config())),
    [prefix +
    (platform === "android" ? "fingerprint" : "EXUpdates.bundle/fingerprint")]:
      strToU8("a".repeat(40)),
  });
  return { bytes, sha256: createHash("sha256").update(bytes).digest("hex") };
}
test("OTA baseline comes from the exact installed artifact, preserving its native identity", () => {
  for (const platform of ["android", "ios"] as const) {
    const f = fixture(platform),
      base = readNativeBaseline(f.bytes, platform, f.sha256);
    expect(base.nativeBuild).toBe(3);
    expect(base.runtime).toBe("a".repeat(40));
    const current = config();
    current.android.versionCode = 4;
    current.ios.buildNumber = "4";
    current.extra.mobileUpdate = {
      revision: 2,
      version: "0.1.1",
      channel: "stable",
    };
    const merged = withNativeBaseline(base, current);
    expect(merged.extra.mobileUpdate.revision).toBe(2);
    expect(merged.android.versionCode).toBe(3);
    expect(merged.ios.buildNumber).toBe("3");
  }
});
test("baseline export rejects a different artifact, platform or native SDK/plugin requirements", () => {
  const f = fixture("android");
  expect(() =>
    readNativeBaseline(f.bytes, "android", "b".repeat(64)),
  ).toThrow();
  expect(() => readNativeBaseline(f.bytes, "ios", f.sha256)).toThrow();
  const base = readNativeBaseline(f.bytes, "android", f.sha256);
  const sdk = config();
  sdk.sdkVersion = "58.0.0";
  expect(() => withNativeBaseline(base, sdk)).toThrow();
  const plugin = config();
  plugin.plugins.push("new-native-module");
  expect(() => withNativeBaseline(base, plugin)).toThrow();
});
