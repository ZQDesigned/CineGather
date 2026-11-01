import { expect, test } from "bun:test";
import {
  nativeEncoderInventorySchema,
  nativeDiagnosticSchema,
  nativeEncoderIdSchema,
} from "@cinegather/contracts";
test("Intel QSV identifiers and adapter classification survive the inventory boundary", () => {
  const id = "qsv:32902:1234:0:1";
  expect(nativeEncoderIdSchema.parse(id)).toBe(id);
  const inventory = nativeEncoderInventorySchema.parse({
    encoders: [
      {
        id,
        backend: "qsv",
        name: "Intel QSV (Intel Arc)",
        hardware: true,
        available: true,
        adapterIndex: 1,
      },
    ],
    adapters: [
      {
        index: 1,
        vendorId: 32902,
        deviceId: 1234,
        name: "Intel Arc",
        gpuType: "discrete",
      },
    ],
    automaticEncoder: id,
    activeEncoder: id,
  });
  expect(inventory.activeEncoder).toBe(id);
  expect(inventory.adapters[0]!.gpuType).toBe("discrete");
  expect(
    nativeEncoderInventorySchema.parse({ encoders: [], adapters: [] }),
  ).toEqual({ encoders: [], adapters: [] });
});
test("QSV startup evidence and driver failures remain exportable", () => {
  const evidence: ReturnType<typeof nativeDiagnosticSchema.parse> = {
    requestedEncoder: "auto",
    selectedEncoder: "qsv:32902:1234:0:1",
    encoderBackend: "qsv",
    hardwareEncoder: true,
    encoderAttempts: [
      { id: "qsv:32902:1234:0:1", backend: "qsv", result: "started" },
    ],
    encoderErrors: [
      {
        backend: "qsv",
        stage: "initialize",
        code: "MFX_ERR_DEVICE_FAILED",
        at: 1,
      },
    ],
  };
  expect(nativeDiagnosticSchema.parse(evidence)).toEqual(evidence);
});
