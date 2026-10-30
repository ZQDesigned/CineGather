import { Directory, File, Paths } from "expo-file-system";
import { strToU8 } from "fflate";
const retentionMs = 2 * 60 * 60 * 1000;
const folder = new Directory(Paths.document, "diagnostics");
export function appendDiagnostic(value: unknown) {
  folder.create({ intermediates: true, idempotent: true });
  const now = Date.now(),
    hour = Math.floor(now / 3600000);
  for (const entry of folder.list())
    if (
      entry instanceof File &&
      /^\d+\.jsonl$/.test(entry.name) &&
      Number(entry.name.split(".")[0]) <
        Math.floor((now - retentionMs) / 3600000)
    )
      entry.delete();
  const file = new File(folder, `${hour}.jsonl`);
  if (!file.exists) file.create();
  // Bound individual samples and storage even if a native stats implementation
  // unexpectedly returns large data. RTC values have already been projected.
  const bytes = strToU8(JSON.stringify(value) + "\n");
  if (bytes.length > 128 * 1024 || (file.size ?? 0) > 80 * 1024 * 1024)
    throw new Error("诊断记录超过存储限制");
  const handle = file.open();
  try {
    handle.offset = file.size;
    handle.writeBytes(bytes);
  } finally {
    handle.close();
  }
}
export function diagnosticFiles(): Record<string, Uint8Array> {
  const result: Record<string, Uint8Array> = {};
  if (folder.exists)
    for (const file of folder.list())
      if (file instanceof File && /^\d+\.jsonl$/.test(file.name))
        result[`history/${file.name}`] = file.bytesSync();
  return result;
}
