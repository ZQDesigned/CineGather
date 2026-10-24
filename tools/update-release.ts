import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
} from "node:crypto";
import { readFile, writeFile, rename } from "node:fs/promises";
import { basename, resolve, dirname, join } from "node:path";
import { parseArgs } from "node:util";
import {
  verifyRelease,
  type Release,
} from "../apps/desktop/src/main/update-release";

export function signRelease(release: Release, privateKey: string) {
  const key = createPrivateKey(privateKey);
  if (key.asymmetricKeyType !== "ed25519")
    throw new Error("Expected an Ed25519 update key");
  const payload = JSON.stringify(release);
  const raw = JSON.stringify({
    payload,
    signature: sign(null, Buffer.from(payload), key).toString("base64"),
  });
  verifyRelease(
    raw,
    createPublicKey(key).export({ type: "spki", format: "pem" }).toString(),
    release.platform,
    release.arch,
  );
  return raw;
}
if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      file: { type: "string" },
      key: { type: "string" },
      notes: { type: "string" },
      out: { type: "string" },
    },
    strict: true,
  });
  if (!values.file || !values.key || !values.out)
    throw new Error(
      "Usage: bun tools/update-release.ts --file <installer> --key <private.pem> --notes <release notes> --out <channel.json>",
    );
  const match =
    /^CineGather-(\d+\.\d+\.\d+)-(win|mac)-(x64|arm64)(-setup\.exe|\.dmg)$/.exec(
      basename(values.file),
    );
  if (!match || (match[2] === "win") !== (match[4] === "-setup.exe"))
    throw new Error("Only a Windows installer or macOS DMG can be published");
  const bytes = await readFile(values.file);
  const key = await readFile(values.key, "utf8");
  const packagedKey = await readFile(
    resolve(import.meta.dir, "../apps/desktop/resources/update-public-key.pem"),
    "utf8",
  );
  const release: Release = {
    format: 1,
    platform: match[2] === "win" ? "win32" : "darwin",
    arch: match[3] as Release["arch"],
    version: match[1]!,
    publishedAt: new Date().toISOString(),
    notes: values.notes ?? "",
    artifact: {
      file: basename(values.file),
      size: bytes.length,
      sha512: createHash("sha512").update(bytes).digest("base64"),
    },
  };
  const raw = signRelease(release, key);
  verifyRelease(raw, packagedKey, release.platform, release.arch);
  const target = resolve(values.out);
  const temporary = join(
    dirname(target),
    `.${basename(target)}.${process.pid}.tmp`,
  );
  await writeFile(temporary, `${raw}\n`, { flag: "wx" });
  await rename(temporary, target);
  console.log(
    `Signed ${release.platform}/${release.arch} ${release.version} metadata: ${target}`,
  );
}
