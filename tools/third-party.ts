import {
  readFile,
  readdir,
  realpath,
  writeFile,
  stat,
  mkdir,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const seen = new Set<string>();
const notices: string[] = [];
async function locate(name: string, from: string) {
  let dir = from;
  while (true) {
    const candidate = join(dir, "node_modules", name, "package.json");
    try {
      await stat(candidate);
      return dirname(await realpath(candidate));
    } catch {
      /* Follow Node's parent lookup. */
    }
    const parent = dirname(dir);
    if (parent === dir)
      throw new Error(`Cannot resolve production license for ${name}`);
    dir = parent;
  }
}
async function walk(directory: string) {
  const pkg = JSON.parse(
    await readFile(join(directory, "package.json"), "utf8"),
  ) as {
    name: string;
    version: string;
    license?: string;
    dependencies?: Record<string, string>;
  };
  const key = `${pkg.name}@${pkg.version}`;
  if (seen.has(key)) return;
  seen.add(key);
  if (!pkg.name.startsWith("@cinegather/")) {
    const sections = [
      key,
      `Declared license: ${pkg.license ?? "not specified"}`,
    ];
    for (const name of (await readdir(directory)).sort()) {
      if (!/^(licen[sc]e|notice)(\.|$)/i.test(name)) continue;
      const path = join(directory, name);
      if (!(await stat(path)).isFile()) continue;
      sections.push(`${name}\n${await readFile(path, "utf8")}`);
    }
    notices.push(sections.join("\n\n"));
  }
  for (const name of Object.keys(pkg.dependencies ?? {}).sort())
    await walk(await locate(name, directory));
}
await walk(join(root, "apps/desktop"));
// Koffi selects a platform-specific optional N-API runtime. Inventory the one
// explicitly shipped by this build, rather than omitting optional packages.
const platform = process.argv[2] ?? process.platform;
const arch = process.argv[3] ?? process.arch;
if (platform !== "web")
  await walk(await locate(`@koromix/koffi-${platform}-${arch}`, root));
// The worklet vendor embeds this Apache-2.0 wrapper and BSD-3-Clause native
// module without declaring them as npm runtime dependencies.
await walk(await locate("@shiguredo/rnnoise-wasm", root));
const licenseCache = join(
  root,
  "node_modules/.cache/cinegather/rnnoise-COPYING",
);
const expectedHash =
  "d597473329bdc1807197a303be09e79882159ea858daa9f06ce780592877534e";
let rnnoiseLicense: string;
try {
  rnnoiseLicense = await readFile(licenseCache, "utf8");
} catch {
  const response = await fetch(
    "https://raw.githubusercontent.com/shiguredo/rnnoise/0aee43d89c685ccadeca5409cb7adc93462f4bc8/COPYING",
    { signal: AbortSignal.timeout(15000) },
  );
  if (!response.ok)
    throw new Error("Unable to obtain the pinned RNNoise binary license");
  rnnoiseLicense = await response.text();
}
if (createHash("sha256").update(rnnoiseLicense).digest("hex") !== expectedHash)
  throw new Error("RNNoise binary license checksum mismatch");
await mkdir(dirname(licenseCache), { recursive: true });
await writeFile(licenseCache, rnnoiseLicense);
notices.push(
  `RNNoise native module bundled by @sapphi-red/web-noise-suppressor\nDeclared license: BSD-3-Clause\n\n${rnnoiseLicense}`,
);
// The npm worklet embeds libDF and its model but only includes the wrapper's
// MIT license. Preserve the pinned upstream dual-license notices as well.
for (const [name, expected] of [
  [
    "LICENSE-MIT",
    "24e6bb09c928af8d8e56268082f87413247ce36b39dd5d33add2f9893968065e",
  ],
  [
    "LICENSE-APACHE",
    "1eaee808c5fb6b4e895ba30425285a5cdc5dd25bba2cd230f264c2200c331aec",
  ],
] as const) {
  const cache = join(
    root,
    "node_modules/.cache/cinegather",
    `deepfilternet-${name}`,
  );
  let license = await readFile(cache, "utf8").catch(() => "");
  if (!license) {
    const response = await fetch(
      `https://raw.githubusercontent.com/Rikorose/DeepFilterNet/d375b2d8309e0935d165700c91da9de862a99c31/${name}`,
      { signal: AbortSignal.timeout(15000) },
    );
    if (!response.ok)
      throw new Error("Unable to obtain pinned DeepFilterNet license");
    license = await response.text();
  }
  if (createHash("sha256").update(license).digest("hex") !== expected)
    throw new Error("DeepFilterNet license checksum mismatch");
  await writeFile(cache, license);
  notices.push(
    `DeepFilterNet3 / libDF bundled by @workadventure/noise-suppression\n${name}\n\n${license}`,
  );
}
const output = join(
  root,
  platform === "web"
    ? "apps/web/dist/THIRD_PARTY_NOTICES.txt"
    : "apps/desktop/resources/THIRD_PARTY_NOTICES.txt",
);
await writeFile(
  output,
  `CineGather third-party package license inventory\nGenerated from installed, locked production dependencies.\n\n${notices.sort().join("\n\n" + "=".repeat(78) + "\n\n")}\n`,
);
console.log(
  `Generated local third-party notices for ${notices.length} packages; never commit this document.`,
);
