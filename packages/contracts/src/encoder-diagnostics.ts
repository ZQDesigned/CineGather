import { z } from "zod";
const n = z.number().finite().nonnegative();
const label = z
  .string()
  .max(160)
  .transform((value) =>
    /(?:https?:|wss?:|Bearer\s|[\\/]|eyJ[A-Za-z0-9_-]+\.)/i.test(value)
      ? "[redacted]"
      : value,
  );
export const diagnosticVideoCodecSchema = z.object({
  mimeType: z.enum([
    "video/H264",
    "video/VP8",
    "video/VP9",
    "video/AV1",
    "video/rtx",
    "video/red",
    "video/ulpfec",
  ]),
  payloadType: n.optional(),
  clockRate: n.optional(),
  sdpFmtpLine: z
    .string()
    .max(200)
    .regex(
      /^(?:(?:profile-level-id=[a-fA-F0-9]{6}|packetization-mode=[01]|level-asymmetry-allowed=[01]|apt=\d{1,3}|profile-id=\d|level-idx=\d{1,2})(?:;|$))*$/,
    )
    .optional(),
});
export const encoderCapabilitiesSchema = z.object({
  status: z.enum(["ok", "unavailable", "failed"]),
  codecs: z.array(diagnosticVideoCodecSchema).max(64),
});
export const senderDiagnosticSchema = z.object({
  status: z.enum(["ok", "unavailable", "failed"]),
  degradationPreference: z
    .enum(["maintain-framerate", "maintain-resolution", "balanced"])
    .optional(),
  codecs: z.array(diagnosticVideoCodecSchema).max(64).optional(),
  encodings: z
    .array(
      z.object({
        active: z.boolean().optional(),
        maxBitrate: n.optional(),
        maxFramerate: n.optional(),
        scaleResolutionDownBy: n.optional(),
        scalabilityMode: z
          .string()
          .max(32)
          .regex(/^[LS][1-3]T[1-3](?:h|_KEY|_KEY_SHIFT)?$/)
          .optional(),
        priority: z.enum(["very-low", "low", "medium", "high"]).optional(),
      }),
    )
    .max(8)
    .optional(),
});
export const gpuDiagnosticSchema = z.object({
  devices: z
    .array(
      z.object({
        vendorId: n.optional(),
        deviceId: n.optional(),
        active: z.boolean().optional(),
        deviceString: label.optional(),
        vendorString: label.optional(),
        driverVendor: label.optional(),
        driverVersion: label.optional(),
        gpuPreference: n.optional(),
      }),
    )
    .max(16),
  profilesReported: z.boolean(),
  encodingProfiles: z
    .array(
      z.object({
        profile: n.optional(),
        minResolutionWidth: n.optional(),
        minResolutionHeight: n.optional(),
        maxResolutionWidth: n.optional(),
        maxResolutionHeight: n.optional(),
        maxFramerateNumerator: n.optional(),
        maxFramerateDenominator: n.optional(),
        bitDepth: n.optional(),
        chromaSampling: n.optional(),
      }),
    )
    .max(128),
  aux: z
    .object({
      softwareRendering: z.boolean().optional(),
      optimus: z.boolean().optional(),
      amdSwitchable: z.boolean().optional(),
      sandboxed: z.boolean().optional(),
      inProcessGpu: z.boolean().optional(),
    })
    .optional(),
});
