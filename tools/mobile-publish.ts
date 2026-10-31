import {
  createHash,
  sign,
  verify,
  randomUUID,
  createPublicKey,
} from "node:crypto";
import {
  readFile,
  writeFile,
  mkdir,
  rename,
  stat,
  realpath,
  open,
  unlink,
} from "node:fs/promises";
import { resolve, join, sep, basename } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import {
  mobileRuntimeSchema,
  mobilePlatformSchema,
  mobileChannelSchema,
  mobileUpdateIndexSchema,
  clientVersionSchema,
} from "@cinegather/contracts";
export const mobileExportSchema = z.object({
  platform: mobilePlatformSchema,
  channel: mobileChannelSchema,
  runtime: mobileRuntimeSchema,
  revision: z.number().int().positive(),
  version: clientVersionSchema,
  nativeBuild: z.number().int().positive(),
  nativeVersion: clientVersionSchema,
  expoClient: z.record(z.string(), z.unknown()),
});
type NativeRelease = {
  version: string;
  build: number;
  minimumBuild: number;
  url?: string;
  notes: string;
};
export async function publishMobileUpdate(options: {
  exportDirectory: string;
  storeDirectory: string;
  privateKey: string;
  certificate: string;
  origin: string;
  minimumRevision?: number;
  notes: string;
  native?: NativeRelease;
}) {
  const directory = await realpath(options.exportDirectory),
    root = resolve(options.storeDirectory),
    origin = new URL(options.origin);
  if (
    origin.protocol !== "https:" &&
    !["127.0.0.1", "localhost", "10.0.2.2"].includes(origin.hostname)
  )
    throw Error("Updates require HTTPS");
  const descriptor = mobileExportSchema.parse(
    JSON.parse(
      await readFile(join(directory, "cinegather-export.json"), "utf8"),
    ),
  );
  const config = descriptor.expoClient.extra as
    | {
        mobileUpdate?: {
          revision?: number;
          version?: string;
          channel?: string;
        };
      }
    | undefined;
  if (
    config?.mobileUpdate?.revision !== descriptor.revision ||
    config.mobileUpdate.version !== descriptor.version ||
    config.mobileUpdate.channel !== descriptor.channel
  )
    throw Error(
      "Exported JavaScript metadata does not match release descriptor",
    );
  await mkdir(join(root, "mobile"), { recursive: true });
  const lockPath = join(root, "mobile/.publish.lock");
  const lock = await open(lockPath, "wx");
  try {
    const pointer = join(
      root,
      "mobile",
      descriptor.channel,
      descriptor.platform + ".json",
    );
    let previous: ReturnType<typeof mobileUpdateIndexSchema.parse> | undefined;
    try {
      previous = mobileUpdateIndexSchema.parse(
        JSON.parse(await readFile(pointer, "utf8")),
      );
    } catch (error) {
      if (
        !(error instanceof Error && "code" in error && error.code === "ENOENT")
      )
        throw error;
    }
    const old = previous?.runtimes.find(
      (r) => r.runtime === descriptor.runtime,
    );
    if (old && descriptor.revision <= old.revision)
      throw Error("Publish a new monotonic revision, including for rollbacks");
    if (
      old &&
      (options.minimumRevision ?? old.minimumRevision) < old.minimumRevision
    )
      throw Error("Minimum revision cannot move backwards");
    const metadata = JSON.parse(
      await readFile(join(directory, "metadata.json"), "utf8"),
    );
    const exported = metadata.fileMetadata?.[descriptor.platform];
    if (
      !exported ||
      !Array.isArray(exported.assets) ||
      exported.assets.length > 2048
    )
      throw Error("Missing Expo platform export");
    for (const path of [
      join(root, "mobile/assets"),
      join(root, "mobile/manifests"),
      join(root, "mobile", descriptor.channel),
    ])
      await mkdir(path, { recursive: true });
    let total = 0;
    const asset = async (path: string, extension?: string) => {
      if (typeof path !== "string" || path.includes("\\"))
        throw Error("Invalid export asset");
      const file = await realpath(resolve(directory, path));
      if (!file.startsWith(directory + sep))
        throw Error("Asset escapes export");
      const size = (await stat(file)).size;
      total += size;
      if (size > 128 * 1024 * 1024 || total > 512 * 1024 * 1024)
        throw Error("Export too large");
      const bytes = await readFile(file),
        digest = createHash("sha256").update(bytes),
        hex = digest.digest("hex"),
        hash = Buffer.from(hex, "hex").toString("base64url");
      const destination = join(root, "mobile/assets", hex);
      try {
        await writeFile(destination, bytes, { flag: "wx" });
      } catch (error) {
        if (
          !(
            error instanceof Error &&
            "code" in error &&
            error.code === "EEXIST"
          )
        )
          throw error;
        if (
          createHash("sha256")
            .update(await readFile(destination))
            .digest("hex") !== hex
        )
          throw Error("Stored asset has been corrupted");
      }
      const types: Record<string, string> = {
        png: "image/png",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        webp: "image/webp",
        gif: "image/gif",
        svg: "image/svg+xml",
        ttf: "font/ttf",
        otf: "font/otf",
        mp3: "audio/mpeg",
        wav: "audio/wav",
        hbc: "application/javascript",
        js: "application/javascript",
      };
      return {
        key: basename(path),
        hash,
        contentType: types[extension ?? "hbc"] ?? "application/octet-stream",
        ...(extension ? { fileExtension: "." + extension } : {}),
        url: `${origin.origin}/api/v1/mobile-updates/assets/${hex}`,
      };
    };
    const updateId = randomUUID(),
      createdAt = new Date(
        Math.max(Date.now(), old ? Date.parse(old.createdAt) + 1 : 0),
      ).toISOString();
    const assets = [];
    for (const item of exported.assets) {
      if (!/^[a-zA-Z0-9]{1,12}$/.test(item.ext))
        throw Error("Invalid asset extension");
      assets.push(await asset(item.path, item.ext));
    }
    const manifest = JSON.stringify({
      id: updateId,
      createdAt,
      runtimeVersion: descriptor.runtime,
      launchAsset: await asset(exported.bundle),
      assets,
      metadata: { channel: descriptor.channel },
      extra: { expoClient: descriptor.expoClient },
    });
    const signature = sign(
      "sha256",
      Buffer.from(manifest),
      options.privateKey,
    ).toString("base64");
    if (
      !verify(
        "sha256",
        Buffer.from(manifest),
        createPublicKey(options.certificate),
        Buffer.from(signature, "base64"),
      )
    )
      throw Error(
        "Private update key does not match the certificate installed in clients",
      );
    if (
      previous &&
      descriptor.nativeBuild > previous.native.build &&
      !options.native
    )
      throw Error(
        "Publishing a new native build requires explicit native release details",
      );
    const native = options.native ??
      previous?.native ?? {
        version: descriptor.nativeVersion,
        build: descriptor.nativeBuild,
        minimumBuild: 0,
        notes: "",
      };
    if (
      previous &&
      (native.build < previous.native.build ||
        native.minimumBuild < previous.native.minimumBuild)
    )
      throw Error("Native build floors cannot move backwards");
    if (native.minimumBuild > 0 && !native.url)
      throw Error("Required native updates need an installation URL");
    const release = {
      runtime: descriptor.runtime,
      revision: descriptor.revision,
      minimumRevision: options.minimumRevision ?? old?.minimumRevision ?? 0,
      version: descriptor.version,
      updateId,
      createdAt,
      notes: options.notes,
    };
    const index = mobileUpdateIndexSchema.parse({
      format: 1,
      platform: descriptor.platform,
      channel: descriptor.channel,
      policyVersion: (previous?.policyVersion ?? 0) + 1,
      native,
      runtimes: [
        ...(previous?.runtimes.filter(
          (r) => r.runtime !== descriptor.runtime,
        ) ?? []),
        release,
      ],
    });
    const manifestPath = join(root, "mobile/manifests", updateId + ".json");
    await writeFile(manifestPath, JSON.stringify({ manifest, signature }), {
      flag: "wx",
    });
    // All immutable assets + signed manifest exist before the only mutable pointer changes.
    const temporary = pointer + `.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(index), { flag: "wx" });
    await rename(temporary, pointer);
    return {
      updateId,
      runtime: descriptor.runtime,
      revision: descriptor.revision,
      policyVersion: index.policyVersion,
      pointer,
    };
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}
if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      export: { type: "string" },
      store: { type: "string" },
      key: { type: "string" },
      origin: { type: "string", default: "https://cgplat.zqdesigned.city" },
      "minimum-revision": { type: "string" },
      notes: { type: "string", default: "" },
      "native-build": { type: "string" },
      "native-version": { type: "string" },
      "minimum-build": { type: "string", default: "0" },
      "install-url": { type: "string" },
    },
    strict: true,
  });
  if (!values.export || !values.store || !values.key)
    throw Error(
      "Usage: bun tools/mobile-publish.ts --export <Expo export> --store <update directory> --key <offline private PEM> [--minimum-revision <revision>] [--native-build <build> --native-version <version> --minimum-build <build> --install-url <HTTPS URL>]",
    );
  console.log(
    await publishMobileUpdate({
      exportDirectory: values.export,
      storeDirectory: values.store,
      privateKey: await readFile(values.key, "utf8"),
      certificate: await readFile(
        new URL(
          "../apps/mobile/resources/update-certificate.pem",
          import.meta.url,
        ),
        "utf8",
      ),
      origin: values.origin!,
      minimumRevision:
        values["minimum-revision"] === undefined
          ? undefined
          : Number(values["minimum-revision"]),
      notes: values.notes!,
      ...(values["native-build"]
        ? {
            native: {
              version: values["native-version"]!,
              build: Number(values["native-build"]),
              minimumBuild: Number(values["minimum-build"]),
              url: values["install-url"],
              notes: values.notes!,
            },
          }
        : {}),
    }),
  );
}
