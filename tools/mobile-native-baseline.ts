import { createHash } from "node:crypto";
import { unzipSync, strFromU8 } from "fflate";
import { z } from "zod";
import { clientVersionSchema } from "@cinegather/contracts";

const clientSchema = z
  .object({
    version: clientVersionSchema,
    sdkVersion: z.string(),
    scheme: z.unknown(),
    plugins: z.array(z.unknown()),
    android: z
      .object({ package: z.string(), versionCode: z.number().int().positive() })
      .passthrough(),
    ios: z
      .object({ bundleIdentifier: z.string(), buildNumber: z.string() })
      .passthrough(),
    updates: z
      .object({
        url: z.string(),
        codeSigningMetadata: z.record(z.string(), z.string()).optional(),
      })
      .passthrough(),
    extra: z.record(z.string(), z.any()),
  })
  .passthrough();
export function readNativeBaseline(
  bytes: Uint8Array,
  platform: "android" | "ios",
  sha256: string,
) {
  if (
    !/^[a-f0-9]{64}$/.test(sha256) ||
    createHash("sha256").update(bytes).digest("hex") !== sha256
  )
    throw Error(
      "Native baseline artifact hash does not match the published download",
    );
  const configPattern =
    platform === "android"
      ? /^assets\/app\.config$/
      : /^Payload\/[^/]+\.app\/EXConstants.bundle\/app.config$/;
  const runtimePattern =
    platform === "android"
      ? /^assets\/fingerprint$/
      : /^Payload\/[^/]+\.app\/EXUpdates.bundle\/fingerprint$/;
  const files = unzipSync(bytes, {
    filter: (entry) => {
      const selected =
        configPattern.test(entry.name) || runtimePattern.test(entry.name);
      if (selected && entry.originalSize > 2 * 1024 * 1024)
        throw Error("Native baseline metadata is too large");
      return selected;
    },
  });
  const configFiles = Object.keys(files).filter((n) => configPattern.test(n));
  const runtimeFiles = Object.keys(files).filter((n) => runtimePattern.test(n));
  if (configFiles.length !== 1 || runtimeFiles.length !== 1)
    throw Error("Native baseline platform metadata is missing or ambiguous");
  const expoClient = clientSchema.parse(
    JSON.parse(strFromU8(files[configFiles[0]!]!)),
  );
  const runtime = strFromU8(files[runtimeFiles[0]!]!).trim();
  if (!/^[a-f0-9]{40}$/.test(runtime))
    throw Error("Native artifact fingerprint is invalid");
  const nativeBuild = Number(
    platform === "android"
      ? expoClient.android.versionCode
      : expoClient.ios.buildNumber,
  );
  if (!Number.isSafeInteger(nativeBuild) || nativeBuild < 1)
    throw Error("Native artifact build is invalid");
  return {
    platform,
    runtime,
    nativeBuild,
    nativeVersion: expoClient.version,
    expoClient,
    sha256,
  };
}
export function withNativeBaseline(
  baseline: ReturnType<typeof readNativeBaseline>,
  value: unknown,
) {
  const current = clientSchema.parse(value),
    original = baseline.expoClient;
  for (const [before, after] of [
    [original.sdkVersion, current.sdkVersion],
    [original.scheme, current.scheme],
    [original.plugins, current.plugins],
    [original.android.package, current.android.package],
    [original.ios.bundleIdentifier, current.ios.bundleIdentifier],
    [original.updates, current.updates],
  ])
    if (JSON.stringify(before) !== JSON.stringify(after))
      throw Error(
        "Native SDK, plugins, identity or update trust changed; use a native release",
      );
  return {
    ...original,
    runtimeVersion: baseline.runtime,
    extra: { ...original.extra, ...current.extra },
  };
}
