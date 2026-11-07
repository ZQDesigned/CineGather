import { readFile, stat } from "node:fs/promises";
import { writeFileSync, renameSync, unlinkSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import {
  newerVersion,
  verifyRelease,
  verifyInstaller,
  signedEnvelope,
  type Release,
} from "./update-release";
import { versionBelow } from "@cinegather/contracts";
import type { UpdateController, UpdateTransport } from "./update-controller";
const record = z.strictObject({
  envelope: z.string().max(65536),
  file: z.string().min(1).max(4096),
});
export class PendingUpdateStore {
  constructor(
    private path: string,
    private key: string,
    private platform: string,
    private arch: string,
  ) {}
  save(release: Release, file: string) {
    const envelope = signedEnvelope(release);
    if (!envelope) throw Error("待安装更新必须有有效签名");
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = this.path + "." + randomUUID() + ".tmp";
    try {
      writeFileSync(
        temporary,
        JSON.stringify({ envelope, file: resolve(file) }),
        { mode: 0o600, flag: "wx" },
      );
      renameSync(temporary, this.path);
    } finally {
      try {
        unlinkSync(temporary);
      } catch {
        /* Already renamed. */
      }
    }
  }
  clear() {
    try {
      unlinkSync(this.path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  async load(currentVersion: string) {
    try {
      if ((await stat(this.path)).size > 140000)
        throw Error("更新缓存记录过大");
      const saved = record.parse(JSON.parse(await readFile(this.path, "utf8")));
      const release = verifyRelease(
        saved.envelope,
        this.key,
        this.platform,
        this.arch,
      );
      if (!newerVersion(release.version, currentVersion))
        throw Error("缓存版本无需安装");
      await verifyInstaller(saved.file, release.artifact);
      return { release, file: saved.file };
    } catch {
      this.clear();
      return undefined;
    }
  }
}
export async function installPendingUpdate(
  controller: UpdateController,
  transport: UpdateTransport,
  store: PendingUpdateStore,
) {
  if (controller.snapshot().mode !== "install") return false;
  const cached = await store.load(controller.snapshot().currentVersion);
  if (!cached) return false;
  // Use fresh signed compatibility information if reachable, but a network failure never authenticates new bytes.
  const [latest, requirement] = await Promise.all([
    transport.latest().catch(() => null),
    transport.minimum?.().catch(() => undefined),
  ]);
  if (requirement)
    controller.requireUpdate(requirement.version, requirement.reason);
  if (
    (latest?.minimumVersion &&
      versionBelow(cached.release.version, latest.minimumVersion)) ||
    (controller.snapshot().minimumVersion &&
      versionBelow(
        cached.release.version,
        controller.snapshot().minimumVersion!,
      ))
  ) {
    store.clear();
    controller.acceptRelease(latest);
    return false;
  }
  controller.acceptRelease(cached.release);
  await controller.download();
  if (controller.snapshot().status !== "downloaded") return false;
  store.clear();
  await controller.install();
  return controller.snapshot().status === "installing";
}
