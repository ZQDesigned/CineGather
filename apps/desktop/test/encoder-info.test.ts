import { expect, test } from "bun:test";
import { projectGPUInfo } from "../src/main/encoder-info";
test("complete GPU projection retains driver/profile evidence without private paths or unreported-profile guesses", () => {
  const projected = projectGPUInfo({
    gpuDevice: [
      {
        vendorId: 4318,
        deviceId: 10243,
        active: true,
        deviceString: "NVIDIA GeForce RTX",
        driverVendor: "NVIDIA",
        driverVersion: "32.0.15.1234",
        devicePath: "C:/private/secret",
      },
    ],
    auxAttributes: { softwareRendering: false, driverPath: "private" },
    videoEncodeAcceleratorSupportedProfiles: [
      {
        profile: 0,
        minResolutionWidth: 32,
        minResolutionHeight: 32,
        maxResolutionWidth: 4096,
        maxResolutionHeight: 4096,
        maxFramerateNumerator: 60,
        maxFramerateDenominator: 1,
        secret: "Bearer private",
      },
    ],
    privateToken: "secret",
  });
  expect(projected.devices[0]).toMatchObject({
    vendorId: 4318,
    driverVersion: "32.0.15.1234",
  });
  expect(projected.profilesReported).toBe(true);
  expect(projected.encodingProfiles[0]).toMatchObject({
    profile: 0,
    maxResolutionWidth: 4096,
  });
  expect(JSON.stringify(projected)).not.toMatch(/private|secret|Bearer/);
  expect(projectGPUInfo({}).profilesReported).toBe(false);
  expect(
    projectGPUInfo({ videoEncodeAcceleratorSupportedProfiles: [] })
      .profilesReported,
  ).toBe(true);
});
