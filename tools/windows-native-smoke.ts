import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect } from "@playwright/test";
import { nativeEncoderInventorySchema } from "@cinegather/contracts";
import { NativeProtocol } from "../apps/desktop/src/main/native-protocol";
if (process.platform !== "win32") throw new Error("Run on Windows");
const runtime = resolve(
  process.argv[2] ?? "apps/desktop/release/win-unpacked/resources/capture/obs",
);
const directory = await mkdtemp(join(tmpdir(), "cg-native-encoder-"));
const child = spawn(
  join(runtime, "bin/64bit/CGScreenCaptureHost.exe"),
  [directory, String(process.pid), "stdio"],
  { stdio: "pipe", windowsHide: true },
);
const pipe = new NativeProtocol(
  (data) => child.stdin.write(data),
  () => child.kill(),
);
child.stdout.setEncoding("utf8");
child.stdout.on("data", (data) => pipe.receive(data));
child.stderr.setEncoding("utf8");
child.stderr.on("data", (data) => {
  for (const line of String(data).split(/\r?\n/))
    if (/^CG_HOST_ERROR [a-z-]+$/.test(line)) console.log(line);
});
child.on("error", (error) => pipe.close(error));
child.on("close", (code) =>
  pipe.close(new Error(`Native host exited ${code}`)),
);
child.stdin.on("error", () => pipe.close());
try {
  const inventory = nativeEncoderInventorySchema.parse(
    await pipe.call({ type: "encoders" }),
  );
  expect(inventory.encoders.find((e) => e.id === "x264")?.available).toBe(true);
  const probe = await pipe.call<{
    status: string;
    framesEncoded: number;
    bytesEncoded: number;
    encoder: {
      captureCountersAvailable: boolean;
      graphicsAdapterVerified: boolean;
      graphicsAdapterIndex: number;
      graphicsVendorId: number;
      selectedEncoder: string;
      hardwareEncoder: boolean;
      encoderAttempts: unknown[];
    };
  }>({ type: "probe", encoder: "x264" });
  expect(probe.status).toBe("ok");
  expect(probe.framesEncoded).toBeGreaterThanOrEqual(30);
  expect(probe.bytesEncoded).toBeGreaterThan(0);
  expect(probe.encoder.selectedEncoder).toBe("x264");
  expect(probe.encoder.hardwareEncoder).toBe(false);
  expect(probe.encoder.graphicsAdapterVerified).toBe(true);
  expect(probe.encoder.captureCountersAvailable).toBe(true);
  expect(probe.encoder.graphicsAdapterIndex).toBe(0);
  expect(probe.encoder.graphicsVendorId).toBe(
    inventory.adapters.find((a) => a.index === 0)?.vendorId,
  );
  expect(probe.encoder.encoderAttempts).toHaveLength(1);
  const missing = await pipe.call<{ status: string; reason: string }>({
    type: "probe",
    encoder: "nvenc:4318:0:0:999",
  });
  expect(missing).toMatchObject({
    status: "failed",
    reason: "encoder-unavailable",
  });
  const stopped = await pipe.call<{
    sourcesActive: boolean;
    outputActive: boolean;
  }>({ type: "status" });
  expect(stopped.sourcesActive).toBe(false);
  expect(stopped.outputActive).toBe(false);
  console.log(
    "Native Windows OBS inventory/manual x264 real H264 packet probe/no-silent-fallback:",
    JSON.stringify({ inventory, probe, missing }),
  );
  const before = performance.now();
  await expect(
    pipe.call({ type: "probe", encoder: "x264", remainingMs: 100 }),
  ).rejects.toThrow("Native host exited 3");
  expect(performance.now() - before).toBeLessThan(3000);
  console.log(
    "Native capture watchdog terminates capture at the lease deadline while a command is blocked.",
  );
} finally {
  child.kill();
  await rm(directory, { recursive: true, force: true });
}
