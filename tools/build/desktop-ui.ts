import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { digest, rendererFiles, runtimeTree } from "@cinegather/update-core";
const root = resolve(import.meta.dir, "../../apps/desktop"),
  pkg = await readFile(resolve(root, "package.json"), "utf8");
const main = await readFile(resolve(root, "out/main/index.cjs"));
const preloads = [];
for (const file of await rendererFiles(resolve(root, "out/preload")))
  preloads.push([
    file,
    digest(await readFile(resolve(root, "out/preload", file))),
  ]);
// Build only after native components. Their build manifests change whenever native inputs change.
const native = [];
for (const file of [
  ".local/native-runtime/game-link/" + process.platform + "-" + process.arch,
  process.platform === "darwin"
    ? ".local/native-runtime/CGScreenCaptureHost.app"
    : ".local/native-runtime/windows/obs",
  ...(process.platform === "win32"
    ? [".local/native-runtime/windows/CGProcessAudioHost.exe"]
    : []),
]) {
  const hash = await runtimeTree(resolve(root, "../..", file)).catch(
    (e: NodeJS.ErrnoException) => {
      if (e.code !== "ENOENT") throw e;
      return "unavailable";
    },
  );
  native.push([file, hash]);
}
const evidence = {
  main: digest(main),
  preloads,
  package: JSON.parse(pkg),
  native,
  electron: JSON.parse(
    await readFile(
      resolve(root, "../../node_modules/electron/package.json"),
      "utf8",
    ),
  ).version,
};
const value = {
  platform: process.platform,
  arch: process.arch,
  runtime: digest(JSON.stringify(evidence)),
};
await writeFile(
  resolve(root, "resources/desktop-runtime.json"),
  JSON.stringify({ identity: value, evidence }, null, 2) + "\n",
);
console.log(`Desktop runtime: ${value.runtime}`);
