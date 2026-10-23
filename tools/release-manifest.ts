import { readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const root = "apps/desktop/release";
const desktop = await Bun.file("apps/desktop/package.json").json();
const api = await Bun.file("apps/api/package.json").json();
const names = (await readdir(root)).filter(
  (n) =>
    n.startsWith(`CineGather-${desktop.version}-`) &&
    /\.(exe|zip|dmg|blockmap)$/.test(n) &&
    !n.includes("__"),
);
if (!names.length) throw new Error(`No artifacts for ${desktop.version}.`);
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
    desktop: desktop.version,
    api: api.version,
    bun: Bun.version,
    electron: desktop.devDependencies.electron,
    node: (await Bun.$`node -p process.versions.node`.text()).trim(),
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
