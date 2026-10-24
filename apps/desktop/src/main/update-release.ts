import { verify, createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { z } from "zod";
import { clientVersionSchema, versionBelow } from "@cinegather/contracts";

export const updateOrigin = "https://cgplat.zqdesigned.city";
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const releaseSchema = z
  .object({
    format: z.literal(1),
    platform: z.enum(["win32", "darwin"]),
    arch: z.enum(["x64", "arm64"]),
    version: z.string().max(40).regex(versionPattern),
    minimumVersion: clientVersionSchema.optional(),
    reason: z.string().max(500).optional(),
    publishedAt: z.iso.datetime(),
    notes: z.string().max(4000),
    artifact: z
      .object({
        file: z.string().max(150),
        size: z
          .number()
          .int()
          .positive()
          .max(2 ** 31),
        sha512: z.string().regex(/^[A-Za-z0-9+/]{86}==$/),
      })
      .strict(),
  })
  .strict();
export type Release = z.infer<typeof releaseSchema>;

export function verifyRelease(
  raw: string,
  publicKey: string,
  platform: string,
  arch: string,
): Release {
  if (Buffer.byteLength(raw) > 65536) throw new Error("更新清单过大");
  const envelope = z
    .object({
      payload: z.string().max(32000),
      signature: z.string().regex(/^[A-Za-z0-9+/]{86}==$/),
    })
    .strict()
    .parse(JSON.parse(raw));
  if (
    !verify(
      null,
      Buffer.from(envelope.payload),
      publicKey,
      Buffer.from(envelope.signature, "base64"),
    )
  )
    throw new Error("更新来源验证失败");
  const release = releaseSchema.parse(JSON.parse(envelope.payload));
  if (
    release.minimumVersion &&
    versionBelow(release.version, release.minimumVersion)
  )
    throw new Error("最低版本不能高于更新版本");
  if (release.platform !== platform || release.arch !== arch)
    throw new Error("更新不适用于当前设备");
  const suffix =
    platform === "win32" ? `win-${arch}-setup.exe` : `mac-${arch}.dmg`;
  if (release.artifact.file !== `CineGather-${release.version}-${suffix}`)
    throw new Error("更新文件名称无效");
  return release;
}
export function artifactURL(release: Release) {
  return new URL(`/downloads/${release.artifact.file}`, updateOrigin).href;
}
export async function verifyInstaller(
  file: string,
  expected: Release["artifact"],
) {
  const info = await stat(file);
  if (!info.isFile() || info.size !== expected.size)
    throw new Error("更新文件大小不符");
  const hash = createHash("sha512");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  if (hash.digest("base64") !== expected.sha512)
    throw new Error("更新文件校验失败");
}
export function newerVersion(candidate: string, current: string) {
  if (!versionPattern.test(candidate) || !versionPattern.test(current))
    return false;
  const a = candidate.split(".").map(Number),
    b = current.split(".").map(Number);
  if (![...a, ...b].every(Number.isSafeInteger)) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i]! > b[i]!;
  }
  return false;
}
export function updateMode(
  platform: string,
  packaged: boolean,
  installed: boolean,
  portable: boolean,
): "install" | "notify" | "disabled" {
  if (!packaged || portable) return "disabled";
  if (platform === "darwin") return "notify";
  return platform === "win32" && installed ? "install" : "disabled";
}

export async function fetchRelease(
  publicKey: string,
  platform: string,
  arch: string,
  request: typeof fetch = fetch,
) {
  const response = await request(
    `${updateOrigin}/updates/stable/${platform}-${arch}.json`,
    {
      signal: AbortSignal.timeout(12000),
      redirect: "error",
      cache: "no-store",
    },
  );
  if (response.status === 404) return null; // The channel has not been published yet.
  if (!response.ok || !response.body) throw new Error("暂时无法连接更新服务");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 65536) throw new Error("更新清单过大");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return verifyRelease(
    Buffer.concat(chunks).toString("utf8"),
    publicKey,
    platform,
    arch,
  );
}
