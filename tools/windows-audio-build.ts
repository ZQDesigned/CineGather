import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(
  root,
  ".local/native-runtime/windows/CGProcessAudioHost.exe",
);
mkdirSync(dirname(output), { recursive: true });
const source = join(root, "native/capture/windows-process-audio.cpp");
if (process.platform === "win32") {
  const vswhere = join(
    process.env["ProgramFiles(x86)"] ?? "C:/Program Files (x86)",
    "Microsoft Visual Studio/Installer/vswhere.exe",
  );
  const vs = execFileSync(
    vswhere,
    [
      "-latest",
      "-products",
      "*",
      "-requires",
      "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
      "-property",
      "installationPath",
    ],
    { encoding: "utf8" },
  ).trim();
  if (!vs) throw new Error("Windows SDK and MSVC x64 build tools are required");
  const environment = join(vs, "VC/Auxiliary/Build/vcvars64.bat");
  const build = spawnSync(
    "cmd.exe",
    [
      "/d",
      "/s",
      "/c",
      `""${environment}" && cl /nologo /std:c++20 /EHsc /MT /O2 /W4 "${source}" /Fe:"${output}" /Fo:"${output}.obj" /link ole32.lib mmdevapi.lib uuid.lib user32.lib"`,
    ],
    { stdio: "inherit", cwd: root, windowsVerbatimArguments: true },
  );
  if (build.error || build.status !== 0)
    throw (
      build.error ??
      new Error(`Windows audio host compilation failed (${build.status})`)
    );
} else {
  const compiler =
    process.env.CG_MINGW_CXX ?? "/opt/homebrew/bin/x86_64-w64-mingw32-g++";
  if (!existsSync(compiler))
    throw new Error(
      "Cross-building the Windows audio host requires mingw-w64 (or CG_MINGW_CXX)",
    );
  execFileSync(
    compiler,
    [
      "-std=c++20",
      "-O2",
      "-Wall",
      "-Wextra",
      "-Werror",
      "-static",
      "-static-libgcc",
      "-static-libstdc++",
      source,
      "-o",
      output,
      "-lole32",
      "-lmmdevapi",
      "-luuid",
      "-luser32",
    ],
    { stdio: "inherit" },
  );
}
console.log(`Windows process audio host built: ${output}`);
