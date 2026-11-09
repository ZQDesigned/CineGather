import { z } from "zod";
import { clientVersionSchema } from "./client-policy";

const artifact = z.object({
  name: z.string(),
  size: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});

export const mobileDownloadsSchema = z
  .object({
    version: clientVersionSchema,
    nativeBuild: z.number().int().positive(),
    revision: z.number().int().positive(),
    releasedAt: z.iso.datetime({ offset: true }),
    files: z.object({ android: artifact, ios: artifact }),
  })
  .refine(
    ({ version, files }) =>
      files.android.name === `CineGather-${version}-android-arm64.apk` &&
      files.ios.name === `CineGather-${version}-ios-self-sign.ipa`,
    "Mobile downloads must contain the matching Android and iOS release",
  );

// Emit canonical UTC for compatibility with already released clients.
export const mobileDownloadsPublicationSchema =
  mobileDownloadsSchema.safeExtend({
    releasedAt: z.iso.datetime(),
  });

export type MobileDownloads = z.infer<typeof mobileDownloadsSchema>;
