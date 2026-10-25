import { expect, test } from "bun:test";
import {
  configureHardwareEncoding,
  hardwareEncodingPolicy,
} from "../src/main/encoding-policy";
function commandLine(initial: Record<string, string> = {}) {
  const flags = new Map(Object.entries(initial));
  return {
    getSwitchValue: (key: string) => flags.get(key) ?? "",
    hasSwitch: (key: string) => flags.has(key),
    appendSwitch: (key: string, value = "") => {
      flags.set(key, value);
    },
  };
}
test("Windows enables hardware constrained-baseline H264 without replacing other feature settings", () => {
  const cli = commandLine({ "enable-features": "ExistingFeature:mode/fast" });
  configureHardwareEncoding("win32", cli);
  expect(cli.getSwitchValue("enable-features")).toBe(
    "ExistingFeature:mode/fast,PlatformH264CbpEncoding",
  );
  configureHardwareEncoding("win32", cli);
  expect(
    cli.getSwitchValue("enable-features").match(/PlatformH264CbpEncoding/g)
      ?.length,
  ).toBe(1);
  expect(hardwareEncodingPolicy("win32", cli)).toMatchObject({
    constrainedBaselineHardwareEnabled: true,
  });
  expect(cli.hasSwitch("ignore-gpu-blocklist")).toBe(false);
  expect(cli.hasSwitch("disable-gpu-sandbox")).toBe(false);
});
test("existing feature parameters and explicit opt-outs remain authoritative", () => {
  const cli = commandLine({
    "enable-features": "PlatformH264CbpEncoding<Trial",
    "disable-features": "PlatformH264CbpEncoding",
  });
  configureHardwareEncoding("win32", cli);
  expect(cli.getSwitchValue("enable-features")).toBe(
    "PlatformH264CbpEncoding<Trial",
  );
  expect(hardwareEncodingPolicy("win32", cli)).toMatchObject({
    constrainedBaselineHardwareEnabled: false,
    explicitlyDisabled: true,
  });
});
test("other operating systems retain their existing encoder policy", () => {
  const cli = commandLine();
  configureHardwareEncoding("darwin", cli);
  expect(cli.hasSwitch("enable-features")).toBe(false);
});
