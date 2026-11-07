import { expect, test } from "bun:test";
import { automaticEncoderLabel } from "../src/renderer/features/sharing/encoder-label";
import type { NativeEncoderInventory } from "@cinegather/contracts";
const inventory: NativeEncoderInventory = {
  adapters: [
    {
      index: 0,
      vendorId: 4098,
      deviceId: 1,
      name: "AMD Radeon Graphics",
      gpuType: "integrated",
    },
    {
      index: 1,
      vendorId: 4318,
      deviceId: 2,
      name: "NVIDIA GeForce RTX",
      gpuType: "discrete",
    },
  ],
  encoders: [
    {
      id: "nvenc:4318:2:0:1",
      name: "NVIDIA NVENC (NVIDIA GeForce RTX)",
      backend: "nvenc",
      hardware: true,
      available: true,
      adapterIndex: 1,
    },
    {
      id: "amf:4098:1:0:0",
      name: "AMD AMF (AMD Radeon Graphics)",
      backend: "amf",
      hardware: true,
      available: true,
      adapterIndex: 0,
    },
    {
      id: "x264",
      name: "软件编码 (x264)",
      backend: "x264",
      hardware: false,
      available: true,
      adapterIndex: 0,
    },
  ],
  automaticEncoder: "amf:4098:1:0:0",
};
test("automatic label explains preferred integrated hardware without claiming it is already running", () => {
  expect(automaticEncoderLabel(inventory, false)).toBe(
    "自动选择（优先：AMD AMF (AMD Radeon Graphics)，核显）",
  );
});
test("active automatic label shows actual fallback instead of the preferred integrated GPU", () => {
  expect(
    automaticEncoderLabel(
      { ...inventory, activeEncoder: inventory.encoders[0]!.id },
      true,
    ),
  ).toBe("自动选择（当前：NVIDIA NVENC (NVIDIA GeForce RTX)，独显）");
  expect(
    automaticEncoderLabel({ ...inventory, activeEncoder: "x264" }, true),
  ).toBe("自动选择（当前：软件编码 (x264)）");
});
test("loading, failed inventory and a starting share never invent an encoder selection", () => {
  expect(automaticEncoderLabel(undefined, false)).toBe("自动选择（检测中）");
  expect(automaticEncoderLabel(undefined, false, true)).toBe(
    "自动选择（暂无法检测）",
  );
  expect(automaticEncoderLabel(inventory, true)).toBe(
    "自动选择（等待编码器启动）",
  );
  expect(automaticEncoderLabel({ encoders: [], adapters: [] }, false)).toBe(
    "自动选择（无可用编码器）",
  );
});
test("stopping a share discards an old active choice and old inventories remain compatible", () => {
  expect(
    automaticEncoderLabel({ ...inventory, activeEncoder: "x264" }, false),
  ).toContain("优先：AMD AMF");
  expect(
    automaticEncoderLabel(
      { encoders: inventory.encoders, adapters: inventory.adapters },
      false,
    ),
  ).toBe("自动选择（共享时确定）");
});
