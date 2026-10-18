import { readFile, readdir, realpath, writeFile, stat } from "node:fs/promises";
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
await walk(await locate(`@koromix/koffi-${platform}-${arch}`, root));
const output = join(root, "apps/desktop/resources/THIRD_PARTY_NOTICES.txt");
await writeFile(
  output,
  `CineGather third-party package license inventory\nGenerated from installed, locked production dependencies.\n\n${notices.sort().join("\n\n" + "=".repeat(78) + "\n\n")}\n`,
);
console.log(
  `Generated local third-party notices for ${notices.length} packages; never commit this document.`,
);
