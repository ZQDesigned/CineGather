import { expect, test } from "bun:test";
import { mobileDownloadsSchema } from "../src/mobile-downloads";

const manifest = () => ({
  version: "0.1.0",
  nativeBuild: 3,
  revision: 1,
  releasedAt: "2026-10-31T12:00:00.000Z",
  files: {
    android: {
      name: "CineGather-0.1.0-android-arm64.apk",
      size: 123456,
      sha256: "a".repeat(64),
    },
    ios: {
      name: "CineGather-0.1.0-ios-self-sign.ipa",
      size: 234567,
      sha256: "b".repeat(64),
    },
  },
});

test("mobile downloads carry their own version and both complete native artifacts", () => {
  expect(mobileDownloadsSchema.parse(manifest()).version).toBe("0.1.0");
  const missing = manifest();
  Reflect.deleteProperty(missing.files, "ios");
  expect(mobileDownloadsSchema.safeParse(missing).success).toBe(false);
});

test("download metadata cannot point to another version, path, or incomplete artifact", () => {
  for (const name of [
    "CineGather-0.1.26-android-arm64.apk",
    "../CineGather-0.1.0-android-arm64.apk",
    "https://example.com/app.apk",
  ]) {
    const value = manifest();
    value.files.android.name = name;
    expect(mobileDownloadsSchema.safeParse(value).success).toBe(false);
  }
  const value = manifest();
  value.files.ios.size = 0;
  expect(mobileDownloadsSchema.safeParse(value).success).toBe(false);
  value.files.ios.size = 234567;
  value.files.ios.sha256 = "truncated";
  expect(mobileDownloadsSchema.safeParse(value).success).toBe(false);
});
