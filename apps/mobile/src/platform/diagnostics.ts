import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { zipSync, strToU8 } from "fflate";
import { diagnosticFiles } from "./journal";
import { runtime } from "../runtime";
export async function exportDiagnostics() {
  const file = new File(
    Paths.cache,
    `cinegather-mobile-diagnostics-${Date.now()}.zip`,
  );
  const bytes = zipSync({
    ...diagnosticFiles(),
    "updates.json": strToU8(
      JSON.stringify(await runtime.updates.diagnostics(), null, 2),
    ),
    "diagnostics.json": strToU8(JSON.stringify(runtime.diagnostics(), null, 2)),
  });
  file.write(bytes);
  if (!(await Sharing.isAvailableAsync()))
    throw new Error("当前设备无法打开分享面板");
  await Sharing.shareAsync(file.uri, {
    mimeType: "application/zip",
    UTI: "public.zip-archive",
    dialogTitle: "导出映聚诊断",
  });
}
