import { readFile } from "node:fs/promises";
import { join } from "node:path";
// A cross-target pack must not accidentally ship the build host's runtime identity.
export default async function (context) {
  const descriptor = JSON.parse(
    await readFile(
      join(context.packager.info.appDir, "resources/desktop-runtime.json"),
      "utf8",
    ),
  );
  const arch = { 1: "x64", 3: "arm64" }[context.arch];
  if (
    !arch ||
    descriptor.identity?.platform !== context.electronPlatformName ||
    descriptor.identity?.arch !== arch
  )
    throw new Error(
      "Desktop runtime target mismatch. Build the native runtime on the target host before packaging.",
    );
}
