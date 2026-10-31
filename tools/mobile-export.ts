import { parseArgs } from "node:util";
import { resolve, join } from "node:path";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import {
  mobilePlatformSchema,
  mobileChannelSchema,
  clientVersionSchema,
} from "@cinegather/contracts";
import { mobileExportSchema } from "./mobile-publish";
import {
  readNativeBaseline,
  withNativeBaseline,
} from "./mobile-native-baseline";
if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      platform: { type: "string" },
      channel: { type: "string", default: "stable" },
      revision: { type: "string" },
      version: { type: "string" },
      out: { type: "string" },
      "native-artifact": { type: "string" },
      "artifact-sha256": { type: "string" },
    },
    strict: true,
  });
  const platform = mobilePlatformSchema.parse(values.platform),
    channel = mobileChannelSchema.parse(values.channel),
    revision = Number(values.revision),
    version = clientVersionSchema.parse(values.version);
  if (!Number.isSafeInteger(revision) || revision < 1 || !values.out)
    throw Error(
      "Usage: bun tools/mobile-export.ts --platform android|ios --channel stable|preview --revision <n> --version <x.y.z> --out <directory>",
    );
  if (!!values["native-artifact"] !== !!values["artifact-sha256"])
    throw Error("Provide both the native artifact and its published SHA256");
  const baseline = values["native-artifact"]
    ? readNativeBaseline(
        await readFile(resolve(values["native-artifact"])),
        platform,
        values["artifact-sha256"]!,
      )
    : undefined;
  const cwd = resolve(import.meta.dir, "../apps/mobile"),
    out = resolve(values.out);
  const env = {
    ...process.env,
    CG_MOBILE_CHANNEL: channel,
    CG_MOBILE_REVISION: String(revision),
    CG_MOBILE_VERSION: version,
    NODE_ENV: "production",
  };
  const command = async (args: string[], capture = false) => {
    const child = Bun.spawn(["bunx", ...args], {
      cwd,
      env,
      stdout: capture ? "pipe" : "inherit",
      stderr: "inherit",
    });
    const text = capture ? await new Response(child.stdout).text() : "";
    if (await child.exited) throw Error("Expo export failed");
    return text;
  };
  const before = JSON.parse(
    await command(
      ["expo-updates", "runtimeversion:resolve", "--platform", platform],
      true,
    ),
  );
  await mkdir(out, { recursive: true });
  await command([
    "expo",
    "export",
    "--platform",
    platform,
    "--output-dir",
    out,
    "--max-workers",
    "2",
  ]);
  const after = JSON.parse(
    await command(
      ["expo-updates", "runtimeversion:resolve", "--platform", platform],
      true,
    ),
  );
  await writeFile(
    join(out, "native-fingerprint-before.json"),
    JSON.stringify(before),
  );
  await writeFile(
    join(out, "native-fingerprint-after.json"),
    JSON.stringify(after),
  );
  if (!before.runtimeVersion || before.runtimeVersion !== after.runtimeVersion)
    throw Error(
      "Native sources changed during export; rebuild/re-export before publishing",
    );
  const sourceConfig = JSON.parse(
    await command(["expo", "config", "--type", "public", "--json"], true),
  );
  const config = baseline
    ? withNativeBaseline(baseline, sourceConfig)
    : sourceConfig;
  const descriptor = mobileExportSchema.parse({
    platform,
    channel,
    runtime: baseline?.runtime ?? after.runtimeVersion,
    revision,
    version,
    nativeBuild: Number(
      platform === "android"
        ? config.android.versionCode
        : config.ios.buildNumber,
    ),
    nativeVersion: config.version,
    expoClient: config,
  });
  if (baseline)
    await writeFile(
      join(out, "native-baseline.json"),
      JSON.stringify({
        platform,
        sha256: baseline.sha256,
        nativeBuild: baseline.nativeBuild,
        runtime: baseline.runtime,
        sourceRuntime: after.runtimeVersion,
      }),
    );
  await writeFile(
    join(out, "cinegather-export.json"),
    JSON.stringify(descriptor),
  );
  console.log(
    JSON.stringify({
      platform,
      channel,
      runtime: descriptor.runtime,
      revision,
      version,
      out,
    }),
  );
}
