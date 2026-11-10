import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { publishBundle, digest, runtimeTree } from "@cinegather/update-core";
import { desktopRuntimeSchema } from "@cinegather/contracts";
const args = process.argv.slice(2);
const value = (flag: string) => {
  const at = args.indexOf(flag);
  if (at < 0 || !args[at + 1]) throw new Error(`Required: ${flag}`);
  return args[at + 1]!;
};
const baseline = JSON.parse(await readFile(value("--runtime"), "utf8")),
  identity = desktopRuntimeSchema.parse(baseline.identity);
const desktop = resolve(import.meta.dir, "../../apps/desktop");
if (
  identity.platform !== process.platform ||
  identity.arch !== process.arch ||
  digest(JSON.stringify(baseline.evidence)) !== identity.runtime
)
  throw new Error(
    "Native runtime descriptor does not match this build host or its evidence",
  );
if (
  JSON.parse(
    await readFile(
      resolve(desktop, "../../node_modules/electron/package.json"),
      "utf8",
    ),
  ).version !== baseline.evidence.electron
)
  throw new Error("Electron changed: full installer required");
if (
  digest(await readFile(resolve(desktop, "out/main/index.cjs"))) !==
  baseline.evidence.main
)
  throw new Error("Main process changed: full installer required");
for (const [file, hash] of baseline.evidence.preloads)
  if (digest(await readFile(resolve(desktop, "out/preload", file))) !== hash)
    throw new Error("Preload changed: full installer required");
for (const [file, hash] of baseline.evidence.native)
  if (
    hash === "unavailable" ||
    (await runtimeTree(resolve(desktop, "../..", file))) !== hash
  )
    throw new Error(
      "Native runtime changed or unavailable: full installer required",
    );
if (
  JSON.stringify(
    JSON.parse(await readFile(resolve(desktop, "package.json"), "utf8")),
  ) !== JSON.stringify(baseline.evidence.package)
)
  throw new Error("Runtime dependencies changed: full installer required");
const result = await publishBundle({
  input: resolve(desktop, "out/renderer"),
  output: value("--output"),
  identity,
  privateKey: await readFile(value("--key"), "utf8"),
  revision: Number(value("--revision")),
  sequence: Number(value("--sequence")),
  minimumRevision: Number(value("--minimum")),
  featureMinimums: JSON.parse(
    args.includes("--features") ? value("--features") : "{}",
  ),
  notes: args.includes("--notes")
    ? await readFile(value("--notes"), "utf8")
    : "",
});
console.log(
  JSON.stringify({
    bundleId: result.bundleId,
    revision: result.policy.revision,
    runtime: identity.runtime,
  }),
);
