import { readFile, writeFile, rename, unlink, open } from "node:fs/promises";
import { resolve, join } from "node:path";
import { parseArgs } from "node:util";
import {
  featurePolicySchema,
  mobileUpdateIndexSchema,
  clientVersionSchema,
  type FeaturePolicy,
  type ClientPlatform,
} from "@cinegather/contracts";
import {
  validateFeatureTargets,
  type FeatureTarget,
} from "./compatibility-publication";
import { verifyRelease } from "../apps/desktop/src/main/update-release";
export async function publishFeaturePolicy(
  policy: FeaturePolicy,
  directory: string,
  publicKey: string,
  webVersion?: string,
) {
  const root = resolve(directory),
    pointer = join(root, "feature-policy.json"),
    lockPath = join(root, ".feature-policy.lock");
  const lock = await open(lockPath, "wx");
  let temporary: string | undefined;
  try {
    const next = featurePolicySchema.parse(policy);
    let previous: FeaturePolicy | undefined;
    try {
      previous = featurePolicySchema.parse(
        JSON.parse(await readFile(pointer, "utf8")),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (previous && next.revision <= previous.revision)
      throw Error(
        "Publish a new monotonic feature-policy revision, including for rollback",
      );
    const targets: Partial<Record<ClientPlatform, FeatureTarget>> = {};
    for (const platform of ["win32", "darwin"] as const) {
      for (const arch of ["x64", "arm64"]) {
        try {
          const release = verifyRelease(
            await readFile(join(root, `${platform}-${arch}.json`), "utf8"),
            publicKey,
            platform,
            arch,
          );
          const old = targets[platform]?.version;
          if (!old || versionBelowLocal(release.version, old))
            targets[platform] = { version: release.version };
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
    }
    for (const platform of ["android", "ios"] as const) {
      try {
        const index = mobileUpdateIndexSchema.parse(
          JSON.parse(
            await readFile(
              join(root, "mobile/stable", platform + ".json"),
              "utf8",
            ),
          ),
        );
        targets[platform] = {
          version: index.native.version,
          build: index.native.build,
          runtimes: index.runtimes,
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    if (webVersion)
      targets.web = { version: clientVersionSchema.parse(webVersion) };
    validateFeatureTargets(next, targets);
    temporary = join(
      root,
      `.feature-policy.${process.pid}.${crypto.randomUUID()}.tmp`,
    );
    await writeFile(temporary, JSON.stringify(next, null, 2) + "\n", {
      flag: "wx",
      mode: 0o644,
    });
    await rename(temporary, pointer);
    temporary = undefined;
  } finally {
    if (temporary) await unlink(temporary).catch(() => {});
    await lock.close();
    await unlink(lockPath);
  }
}
import { versionBelow as versionBelowLocal } from "@cinegather/contracts";
if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      file: { type: "string" },
      store: { type: "string" },
      "public-key": { type: "string" },
      "web-version": { type: "string" },
    },
    strict: true,
  });
  if (!values.file || !values.store || !values["public-key"])
    throw Error(
      "Usage: bun tools/feature-policy-publish.ts --file <policy.json> --store <update directory> --public-key <desktop update public key> [--web-version <deployed version>]",
    );
  await publishFeaturePolicy(
    JSON.parse(await readFile(values.file, "utf8")),
    values.store,
    await readFile(values["public-key"], "utf8"),
    values["web-version"],
  );
  console.log(
    "Published feature policy only; global version floors unchanged.",
  );
}
