import {
  readdir,
  readFile,
  mkdir,
  rename,
  lstat,
  open,
  rm,
} from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { createPublicKey } from "node:crypto";
import {
  desktopManifestSchema,
  desktopPolicySchema,
  type DesktopRuntime,
  type DesktopPolicy,
} from "@cinegather/contracts";
import { digest, signDocument, verifyDocument } from "./index";
export async function atomicWrite(path: string, bytes: string | Uint8Array) {
  const tmp = path + `.${crypto.randomUUID()}.tmp`;
  try {
    const file = await open(tmp, "wx", 0o600);
    try {
      await file.writeFile(bytes);
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(tmp, path);
  } finally {
    await rm(tmp, { force: true }).catch(() => {});
  }
}
export async function rendererFiles(
  root: string,
  prefix = "",
): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(join(root, prefix), {
    withFileTypes: true,
  })) {
    const name = prefix + entry.name;
    if (entry.isSymbolicLink())
      throw new Error("Renderer symlinks are forbidden");
    if (entry.isDirectory())
      files.push(...(await rendererFiles(root, name + "/")));
    else if (entry.isFile()) files.push(name);
    else throw new Error("Unsupported renderer entry");
  }
  return files.sort();
}
export async function publishBundle(options: {
  input: string;
  output: string;
  identity: DesktopRuntime;
  privateKey: string;
  revision: number;
  sequence: number;
  minimumRevision: number;
  featureMinimums: DesktopPolicy["featureMinimums"];
  notes: string;
}) {
  const { input, output, identity, privateKey } = options;
  const files = [];
  const assets = new Map<string, Buffer>();
  for (const path of await rendererFiles(input)) {
    if (!(await lstat(join(input, path))).isFile())
      throw new Error("Invalid renderer entry");
    const bytes = await readFile(join(input, path)),
      gz = gzipSync(bytes);
    files.push({
      path,
      sha256: digest(bytes),
      size: bytes.length,
      compressedSha256: digest(gz),
      compressedSize: gz.length,
    });
    assets.set(digest(gz), gz);
  }
  const manifest = desktopManifestSchema.parse({
    ...identity,
    format: 1,
    kind: "desktop-ui",
    revision: options.revision,
    entry: "index.html",
    files,
  });
  const raw = signDocument(manifest, privateKey),
    bundleId = digest(raw);
  const policy = desktopPolicySchema.parse({
    ...identity,
    format: 1,
    kind: "desktop-ui-policy",
    bundleId,
    sequence: options.sequence,
    revision: options.revision,
    minimumRevision: options.minimumRevision,
    featureMinimums: options.featureMinimums,
    publishedAt: new Date().toISOString(),
    notes: options.notes,
  });
  const folder = join(
      output,
      "policies",
      `${identity.platform}-${identity.arch}`,
    ),
    pointer = join(folder, identity.runtime + ".json");
  await mkdir(folder, { recursive: true });
  await mkdir(join(output, "manifests"), { recursive: true });
  await mkdir(join(output, "assets"), { recursive: true });
  const previous = await readFile(pointer, "utf8").catch(
    (e: NodeJS.ErrnoException) => {
      if (e.code !== "ENOENT") throw e;
      return undefined;
    },
  );
  if (previous) {
    const old = verifyDocument(
      previous,
      createPublicKey(privateKey)
        .export({ type: "spki", format: "pem" })
        .toString(),
      "policy",
      identity,
    );
    if (
      policy.sequence <= old.sequence ||
      policy.revision <= old.revision ||
      policy.minimumRevision < old.minimumRevision ||
      Object.entries(old.featureMinimums).some(
        ([f, r]) =>
          (policy.featureMinimums[f as keyof typeof old.featureMinimums] ?? 0) <
          r!,
      )
    )
      throw new Error(
        "Publication must advance without lowering compatibility floors",
      );
  }
  for (const [hash, bytes] of assets)
    await atomicWrite(join(output, "assets", hash + ".gz"), bytes);
  await atomicWrite(join(output, "manifests", bundleId + ".json"), raw);
  await atomicWrite(pointer, signDocument(policy, privateKey));
  await atomicWrite(
    join(output, "changed"),
    JSON.stringify({ at: new Date().toISOString(), sequence: policy.sequence }),
  );
  return { bundleId, policy, manifest };
}
