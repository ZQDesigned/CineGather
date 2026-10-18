import { readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const root = "apps/desktop/release";
const names = (await readdir(root)).filter(
  (n) => /\.(exe|zip|dmg|blockmap)$/.test(n) && !n.includes("__"),
);
const artifacts = [];
for (const name of names) {
  const file = Bun.file(`${root}/${name}`);
  artifacts.push({
    name,
    bytes: file.size,
    sha256: createHash("sha256")
      .update(new Uint8Array(await file.arrayBuffer()))
      .digest("hex"),
  });
}
const gitSha = (await Bun.$`git rev-parse HEAD`.text()).trim();
const dirty = Boolean((await Bun.$`git status --porcelain`.text()).trim());
const lock = createHash("sha256")
  .update(new Uint8Array(await Bun.file("bun.lock").arrayBuffer()))
  .digest("hex");
const migrations = await Bun.file(
  "packages/database/migrations/meta/_journal.json",
).json();
const manifest = {
  createdAt: new Date().toISOString(),
  gitSha,
  dirty,
  versions: {
    desktop: "0.1.0",
    api: "0.1.0",
    bun: Bun.version,
    electron: "44.9.0",
    node: process.versions.node,
    livekit: "1.13.10",
  },
  lockSha256: lock,
  migrations,
  unsigned: true,
  artifacts,
};
await writeFile(`${root}/manifest.json`, JSON.stringify(manifest, null, 2));
console.log(
  `Release manifest written (${artifacts.length} artifacts, git ${gitSha.slice(0, 7)}, dirty=${dirty}).`,
);
