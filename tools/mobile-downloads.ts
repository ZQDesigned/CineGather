import { createHash } from "node:crypto";
import { readFile, stat, writeFile, rename } from "node:fs/promises";
import { resolve, join } from "node:path";
import { mobileDownloadsSchema } from "@cinegather/contracts";
import release from "../apps/mobile/mobile-release.json";

const directory = resolve(Bun.argv[2] ?? ".local/mobile/artifacts");
const artifact = async (suffix: string) => {
  const name = `CineGather-${release.version}-${suffix}`;
  const file = join(directory, name);
  const info = await stat(file);
  if (!info.isFile() || info.size < 1024 * 1024)
    throw new Error(`Mobile package is missing or incomplete: ${name}`);
  const bytes = await readFile(file);
  return {
    name,
    size: info.size,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
};
const manifest = mobileDownloadsSchema.parse({
  version: release.version,
  nativeBuild: release.nativeBuild,
  revision: release.revision,
  releasedAt: new Date().toISOString(),
  files: {
    android: await artifact("android-arm64.apk"),
    ios: await artifact("ios-self-sign.ipa"),
  },
});
const target = join(directory, "mobile-latest.json");
await writeFile(`${target}.tmp`, JSON.stringify(manifest, null, 2) + "\n");
await rename(`${target}.tmp`, target);
await writeFile(
  join(directory, "mobile-SHA256SUMS"),
  Object.values(manifest.files)
    .map((file) => `${file.sha256}  ${file.name}\n`)
    .join(""),
);
console.log(JSON.stringify(manifest));
