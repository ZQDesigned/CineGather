import { readdir, readFile, lstat, readlink, realpath } from "node:fs/promises";
import { join, sep } from "node:path";
import { digest } from "./index";
/** Hash native bytes and internal macOS framework links, never labels alone. */
export async function runtimeTree(root: string): Promise<string> {
  const base = await realpath(root),
    entries: unknown[] = [];
  async function visit(path: string, relative: string, ancestors: Set<string>) {
    const info = await lstat(path),
      canonical = await realpath(path);
    if (canonical !== base && !canonical.startsWith(base + sep))
      throw new Error("Runtime link leaves its bundle");
    if (info.isSymbolicLink())
      entries.push([relative, "link", await readlink(path)]);
    const { stat } = await import("node:fs/promises"),
      target = info.isSymbolicLink() ? await stat(path) : info;
    if (target.isDirectory()) {
      if (ancestors.has(canonical)) throw new Error("Runtime symlink cycle");
      const next = new Set(ancestors).add(canonical);
      for (const name of (await readdir(path)).sort())
        await visit(join(path, name), relative + "/" + name, next);
    } else if (target.isFile())
      entries.push([relative, digest(await readFile(path))]);
    else throw new Error("Unsupported native runtime file");
  }
  await visit(root, "", new Set());
  return digest(JSON.stringify(entries));
}
