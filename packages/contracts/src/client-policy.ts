export const clientUpdateOrigin = "https://cgplat.zqdesigned.city";
import { z } from "zod";
export const clientVersionSchema = z
  .string()
  .max(40)
  .regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/)
  .refine((value) =>
    value.split(".").every((part) => Number.isSafeInteger(Number(part))),
  );
export const clientPolicySchema = z.object({
  minimumVersions: z.object({
    win32: clientVersionSchema,
    darwin: clientVersionSchema,
    web: clientVersionSchema,
  }),
  reason: z.string().min(1).max(500),
});
export type ClientPolicy = z.infer<typeof clientPolicySchema>;
export function versionBelow(version: string, minimum: string): boolean {
  if (!clientVersionSchema.safeParse(minimum).success) return false;
  if (!clientVersionSchema.safeParse(version).success) return true;
  const current = version.split(".").map(Number),
    required = minimum.split(".").map(Number);
  for (let i = 0; i < 3; i++)
    if (current[i] !== required[i]) return current[i]! < required[i]!;
  return false;
}
