import { expect, test } from "bun:test";
import {
  mobileDownloadsSchema,
  mobileDownloadsPublicationSchema,
} from "../src/mobile-downloads";

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

test("download metadata accepts real ISO timezone offsets from release tooling", () => {
  for (const releasedAt of [
    "2026-11-08T16:16:19.504406+00:00",
    "2026-11-09T00:16:19.504406+08:00",
    "2026-11-08T11:16:19-05:00",
  ]) {
    expect(
      mobileDownloadsSchema.safeParse({ ...manifest(), releasedAt }).success,
    ).toBe(true);
  }
  for (const releasedAt of [
    "2026-11-08T16:16:19",
    "not a date",
    "2026-02-30T16:16:19Z",
    "2026-11-08T16:16:19+26:00",
  ]) {
    expect(
      mobileDownloadsSchema.safeParse({ ...manifest(), releasedAt }).success,
    ).toBe(false);
  }
});

test("published download metadata stays canonical UTC for older web clients", () => {
  expect(mobileDownloadsPublicationSchema.safeParse(manifest()).success).toBe(
    true,
  );
  expect(
    mobileDownloadsPublicationSchema.safeParse({
      ...manifest(),
      releasedAt: "2026-11-08T16:16:19.504406+00:00",
    }).success,
  ).toBe(false);
  const mismatched = manifest();
  mismatched.files.ios.name = "other.ipa";
  expect(mobileDownloadsPublicationSchema.safeParse(mismatched).success).toBe(
    false,
  );
});
