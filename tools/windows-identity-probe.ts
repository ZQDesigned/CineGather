import type { ElectronApplication } from "@playwright/test";

export async function windowsProcessIdentity(application: ElectronApplication) {
  return application.evaluate(async ({ app }) => {
    const { createRequire } = await import("node:module");
    const { join } = await import("node:path");
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
        identity = ffi.decode(pointer[0], "str16") as string;
      } finally {
        free(pointer[0]);
      }
    }
    return { hresult, identity, version: app.getVersion() };
  });
}
