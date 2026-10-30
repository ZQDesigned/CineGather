import { test, expect } from "bun:test";
import { sessionDevice } from "../src/session-device";
test("records a bounded human-readable client label without storing raw user agent", () => {
  const device = sessionDevice({
    platform: "win32",
    version: "0.1.18",
    agent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/148 Electron/44.9.0",
    address: "203.0.113.7",
  });
  expect(device).toEqual({
    deviceName: "Windows 客户端",
    clientPlatform: "win32",
    clientVersion: "0.1.18",
    loginAddress: "203.0.113.7",
  });
  expect(
    sessionDevice({
      platform: "web",
      agent: "Mozilla/5.0 (Macintosh; Intel Mac OS X) Chrome/148.0",
      address: "::1",
    }).deviceName,
  ).toBe("Chrome（macOS）");
});
test("untrusted headers do not introduce arbitrary labels or unbounded stored input", () => {
  const device = sessionDevice({
    platform: "<script>",
    version: "x".repeat(3000),
    agent: "x".repeat(10000),
    address: "x".repeat(4000),
  });
  expect(device.deviceName).toBe("未知设备");
  expect(device.clientVersion).toBeNull();
  expect(device.loginAddress).toBeNull();
  expect(Object.keys(device).sort()).toEqual([
    "clientPlatform",
    "clientVersion",
    "deviceName",
    "loginAddress",
  ]);
});

test("native mobile clients have useful session names even without a browser user agent", () => {
  for (const [platform, label] of [
    ["android", "Android 客户端"],
    ["ios", "iOS 客户端"],
  ]) {
    const device = sessionDevice({
      platform,
      version: "0.1.26",
      address: "203.0.113.2",
    });
    expect(device.deviceName).toBe(label!);
    expect(device.clientPlatform).toBe(platform!);
    expect(device.clientVersion).toBe("0.1.26");
  }
});
