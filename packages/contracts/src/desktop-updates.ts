import { z } from "zod";
import { featureIdSchema } from "./feature-compatibility";
export const desktopDigest = z.string().regex(/^[a-f0-9]{64}$/);
export const desktopRuntimeSchema = z.strictObject({
  platform: z.enum(["win32", "darwin"]),
  arch: z.enum(["x64", "arm64"]),
  runtime: desktopDigest,
});
export type DesktopRuntime = z.infer<typeof desktopRuntimeSchema>;
const revision = z.number().int().min(0).max(2147483647);
export function rendererPath(path: string) {
  return (
    path.length <= 220 &&
    /^[a-zA-Z0-9_@./-]+$/.test(path) &&
    !path.startsWith("/") &&
    path
      .split("/")
      .every(
        (p) =>
          p !== "" &&
          p !== "." &&
          p !== ".." &&
          !/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(p),
      ) &&
    /\.(html|js|css|json|png|svg|ico|jpg|jpeg|webp|gif|woff2?|ttf|otf|wasm|gz|wav|mp3|ogg|bin)$/i.test(
      path,
    )
  );
}
export const desktopFileSchema = z.strictObject({
  path: z.string().refine(rendererPath),
  sha256: desktopDigest,
  size: z
    .number()
    .int()
    .positive()
    .max(32 * 1024 * 1024),
  compressedSha256: desktopDigest,
  compressedSize: z
    .number()
    .int()
    .positive()
    .max(33 * 1024 * 1024),
});
export const desktopManifestSchema = desktopRuntimeSchema
  .extend({
    format: z.literal(1),
    kind: z.literal("desktop-ui"),
    revision: revision.min(1),
    entry: z.literal("index.html"),
    files: z.array(desktopFileSchema).min(1).max(256),
  })
  .superRefine((value, ctx) => {
    const names = value.files.map((f) => f.path.toLowerCase());
    if (
      new Set(names).size !== names.length ||
      !names.includes("index.html") ||
      value.files.reduce((s, f) => s + f.size, 0) > 128 * 1024 * 1024
    )
      ctx.addIssue({ code: "custom", message: "Invalid renderer file set" });
  });
export const desktopPolicySchema = desktopRuntimeSchema
  .extend({
    format: z.literal(1),
    kind: z.literal("desktop-ui-policy"),
    sequence: revision.min(1),
    revision: revision.min(1),
    bundleId: desktopDigest,
    minimumRevision: revision,
    featureMinimums: z.partialRecord(featureIdSchema, revision),
    publishedAt: z.iso.datetime(),
    notes: z.string().max(4000),
  })
  .refine(
    (p) =>
      p.minimumRevision <= p.revision &&
      Object.values(p.featureMinimums).every((v) => v! <= p.revision),
  );
export type DesktopPolicy = z.infer<typeof desktopPolicySchema>;
export type DesktopManifest = z.infer<typeof desktopManifestSchema>;
export type DesktopUIIdentity = DesktopRuntime & {
  revision: number;
  bundleId: string;
};
export interface DesktopHotStatus {
  enabled: boolean;
  identity: DesktopUIIdentity;
  phase:
    | "idle"
    | "checking"
    | "available"
    | "downloading"
    | "ready"
    | "applying"
    | "error";
  revision?: number;
  required: boolean;
  notes?: string;
  error?: string;
  progress?: number;
  blocked?: string;
}
export interface DesktopHotBridge {
  bootstrap(): Promise<DesktopUIIdentity>;
  ready(bundleId: string): Promise<void>;
  status(): Promise<DesktopHotStatus>;
  check(): Promise<void>;
  download(): Promise<void>;
  apply(): Promise<boolean>;
  activity(busy: boolean): Promise<void>;
  prepareResult(input: { id: string; safe: boolean }): Promise<void>;
  onPrepare(callback: (id: string) => void): () => void;
  onChange(callback: (status: DesktopHotStatus) => void): () => void;
}
