import { z } from "zod";
export const nativeEncoderIdSchema = z
  .string()
  .max(120)
  .regex(/^(?:auto|x264|(?:nvenc|amf):\d+:\d+:\d+:\d+)$/);
export const nativeEncoderInventorySchema = z.object({
  encoders: z
    .array(
      z.object({
        id: nativeEncoderIdSchema,
        name: z.string().max(200),
        backend: z.enum(["nvenc", "amf", "x264"]),
        available: z.boolean(),
        hardware: z.boolean(),
        adapterIndex: z.number().int().nonnegative(),
      }),
    )
    .max(32),
  adapters: z
    .array(
      z.object({
        index: z.number().int().nonnegative(),
        vendorId: z.number().int().nonnegative(),
        deviceId: z.number().int().nonnegative(),
        name: z.string().max(160),
      }),
    )
    .max(16),
});
export type NativeEncoderInventory = z.infer<
  typeof nativeEncoderInventorySchema
>;
