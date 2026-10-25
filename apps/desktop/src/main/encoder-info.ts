import { gpuDiagnosticSchema } from "@cinegather/contracts";
export function projectGPUInfo(input: unknown) {
  const value =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};
  const raw = value.videoEncodeAcceleratorSupportedProfiles;
  const shape = gpuDiagnosticSchema.shape;
  const projectArray = (
    schema: typeof shape.devices | typeof shape.encodingProfiles,
    rows: unknown,
  ) =>
    Array.isArray(rows)
      ? rows.slice(0, 128).flatMap((row) => {
          const parsed = schema.element.safeParse(row);
          return parsed.success ? [parsed.data] : [];
        })
      : [];
  return gpuDiagnosticSchema.parse({
    devices: projectArray(shape.devices, value.gpuDevice).slice(0, 16),
    profilesReported: Array.isArray(raw),
    encodingProfiles: projectArray(shape.encodingProfiles, raw),
    aux: shape.aux.safeParse(value.auxAttributes).data,
  });
}
