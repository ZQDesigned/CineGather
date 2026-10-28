/* eslint-disable @typescript-eslint/no-require-imports -- Electron debugging contexts expose require but no dynamic-import hook. */
import type { ElectronApplication } from "@playwright/test";

export async function windowsProcessIdentity(application: ElectronApplication) {
  return application.evaluate(({ app }) => {
    const { createRequire } =
      require("node:module") as typeof import("node:module");
    const { join } = require("node:path") as typeof import("node:path");
    const load = createRequire(join(app.getAppPath(), "package.json"));
    const ffi = load(
      join(process.resourcesPath, "native/node_modules/koffi/index.cjs"),
    ) as typeof import("koffi");
    const query = ffi
      .load("shell32.dll")
      .func(
        "int32_t __stdcall GetCurrentProcessExplicitAppUserModelID(_Out_ void **identity)",
      );
    const free = ffi
      .load("ole32.dll")
      .func("void __stdcall CoTaskMemFree(void *memory)");
    const pointer: [unknown] = [null];
    const hresult = query(pointer) as number;
    let identity: string | null = null;
    if (pointer[0]) {
      try {
        identity = ffi.decode.string16(pointer[0]);
      } finally {
        free(pointer[0]);
      }
    }
    return { hresult, identity, version: app.getVersion() };
  });
}
