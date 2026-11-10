import { mkdir, readFile, lstat, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { gunzipSync } from "node:zlib";
import { z } from "zod";
import {
  desktopDigest,
  type DesktopPolicy,
  type DesktopRuntime,
  type DesktopManifest,
  type DesktopUIIdentity,
} from "@cinegather/contracts";
import { digest, verifyDocument, atomicWrite } from "@cinegather/update-core";
const journalSchema = z.object({
  active: z.string(),
  previous: z.string().optional(),
  pending: desktopDigest.optional(),
  attempt: desktopDigest.optional(),
  bad: z.array(desktopDigest).max(100),
  policy: z.string().optional(),
});
const csp =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' http: https: ws: wss:; media-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
const mime: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript",
  css: "text/css",
  json: "application/json",
  svg: "image/svg+xml",
  png: "image/png",
  ico: "image/x-icon",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  wasm: "application/wasm",
  woff: "font/woff",
  woff2: "font/woff2",
  wav: "audio/wav",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
};
export class HotStore {
  private journal: z.infer<typeof journalSchema> = {
    active: "factory",
    bad: [],
  };
  current = "factory";
  policy?: DesktopPolicy;
  constructor(
    readonly options: {
      root: string;
      factory: string;
      identity: DesktopRuntime;
      publicKey: string;
      log?: (phase: string, data?: Record<string, unknown>) => void;
    },
  ) {}
  useFactory() {
    this.current = "factory";
  }
  get quarantined() {
    return this.journal.bad;
  }
  get pending() {
    return this.journal.pending;
  }
  get identity(): DesktopUIIdentity {
    return { ...this.options.identity, revision: 0, bundleId: this.current };
  }
  async identityForCurrent() {
    return {
      ...this.identity,
      revision:
        this.current === "factory"
          ? 0
          : (await this.manifest(this.current)).revision,
    };
  }
  get url() {
    return `app://cinegather/ui/${this.current}/index.html`;
  }
  private log(phase: string, data?: Record<string, unknown>) {
    this.options.log?.(phase, data);
  }
  private save() {
    return atomicWrite(
      join(this.options.root, "journal.json"),
      JSON.stringify(this.journal),
    );
  }
  async initialize() {
    await mkdir(join(this.options.root, "assets"), { recursive: true });
    await mkdir(join(this.options.root, "manifests"), { recursive: true });
    try {
      this.journal = journalSchema.parse(
        JSON.parse(
          await readFile(join(this.options.root, "journal.json"), "utf8"),
        ),
      );
      if (this.journal.policy)
        this.policy = verifyDocument(
          this.journal.policy,
          this.options.publicKey,
          "policy",
          this.options.identity,
        );
    } catch (e) {
      this.log("journal-recovery", {
        reason: e instanceof Error ? e.message : "unreadable",
      });
      this.journal = { active: "factory", bad: [] };
    }
    if (this.journal.attempt) {
      this.journal.bad = [
        ...new Set([...this.journal.bad, this.journal.attempt]),
      ].slice(-100);
      this.journal.active = this.journal.previous ?? "factory";
      this.journal.attempt = undefined;
      this.journal.pending = undefined;
      this.log("boot-rollback");
    }
    this.current = this.journal.active;
    try {
      if (this.current !== "factory") await this.validate(this.current);
    } catch {
      this.log("active-invalid");
      this.current = this.journal.active = "factory";
    }
    await this.save();
  }
  async manifest(id: string): Promise<DesktopManifest> {
    desktopDigest.parse(id);
    const raw = await readFile(
      join(this.options.root, "manifests", id + ".json"),
      "utf8",
    );
    if (digest(raw) !== id) throw new Error("资源清单摘要不符");
    return verifyDocument(
      raw,
      this.options.publicKey,
      "manifest",
      this.options.identity,
    );
  }
  async accept(raw: Uint8Array | string) {
    const text =
        typeof raw === "string" ? raw : Buffer.from(raw).toString("utf8"),
      policy = verifyDocument(
        text,
        this.options.publicKey,
        "policy",
        this.options.identity,
      );
    if (
      this.policy &&
      (policy.sequence < this.policy.sequence ||
        (policy.sequence === this.policy.sequence &&
          text !== this.journal.policy) ||
        policy.minimumRevision < this.policy.minimumRevision ||
        Object.entries(this.policy.featureMinimums).some(
          ([key, min]) =>
            (policy.featureMinimums[
              key as keyof typeof policy.featureMinimums
            ] ?? 0) < min!,
        ))
    )
      throw new Error("拒绝回放或降低兼容要求的更新策略");
    this.policy = policy;
    this.journal.policy = text;
    await this.save();
    this.log("policy-verified", {
      sequence: policy.sequence,
      revision: policy.revision,
    });
  }
  async stage(
    fetch: (path: string, max: number) => Promise<Uint8Array>,
    progress?: (percent: number) => void,
  ) {
    const policy = this.policy;
    if (!policy) throw new Error("缺少已签名更新策略");
    if (this.journal.bad.includes(policy.bundleId))
      throw new Error("此资源更新启动失败，已暂停使用，等待修复版");
    const raw = await fetch(`manifests/${policy.bundleId}.json`, 256 * 1024);
    if (digest(raw) !== policy.bundleId) throw new Error("资源清单摘要不符");
    const manifest = verifyDocument(
      Buffer.from(raw).toString("utf8"),
      this.options.publicKey,
      "manifest",
      this.options.identity,
    );
    if (manifest.revision !== policy.revision) throw new Error("资源修订不符");
    let complete = 0;
    for (const file of manifest.files) {
      const path = join(this.options.root, "assets", file.sha256);
      let valid = await this.file(path, file.size, file.sha256)
        .then(() => true)
        .catch(() => false);
      if (!valid) {
        const factory = resolve(this.options.factory, file.path);
        const bytes = await this.file(factory, file.size, file.sha256).catch(
          () => undefined,
        );
        if (bytes) {
          await atomicWrite(path, bytes);
          valid = true;
        }
      }
      if (!valid) {
        const compressed = await fetch(
          `assets/${file.compressedSha256}.gz`,
          file.compressedSize,
        );
        if (
          compressed.length !== file.compressedSize ||
          digest(compressed) !== file.compressedSha256
        )
          throw new Error("更新下载不完整");
        const bytes = gunzipSync(compressed, { maxOutputLength: file.size });
        if (bytes.length !== file.size || digest(bytes) !== file.sha256)
          throw new Error("更新内容校验失败");
        await atomicWrite(path, bytes);
      }
      progress?.((++complete / manifest.files.length) * 100);
    }
    await atomicWrite(
      join(this.options.root, "manifests", policy.bundleId + ".json"),
      raw,
    );
    await this.validate(policy.bundleId);
    this.journal.pending = policy.bundleId;
    await this.save();
    this.log("bundle-staged", { bundleId: policy.bundleId });
  }
  private async file(path: string, size: number, hash: string) {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size !== size)
      throw new Error("资源文件无效");
    const bytes = await readFile(path);
    if (bytes.length !== size || digest(bytes) !== hash)
      throw new Error("资源已损坏");
    return bytes;
  }
  private async validate(id: string) {
    const manifest = await this.manifest(id);
    for (const f of manifest.files)
      await this.file(
        join(this.options.root, "assets", f.sha256),
        f.size,
        f.sha256,
      );
  }
  async discardPending(reason: string) {
    this.log("pending-discarded", { reason, bundleId: this.journal.pending });
    this.journal.pending = undefined;
    await this.save();
  }
  async begin() {
    const id = this.pending;
    if (!id || this.journal.bad.includes(id)) return false;
    await this.validate(id);
    const before = structuredClone(this.journal);
    this.journal.previous = this.journal.active;
    this.journal.attempt = id;
    try {
      await this.save();
    } catch (error) {
      this.journal = before;
      throw error;
    }
    this.current = id;
    this.log("activation-start", { bundleId: id });
    return true;
  }
  async ready(id: string) {
    if (id !== this.current) throw new Error("启动确认的界面不匹配");
    if (this.journal.attempt === id) {
      this.journal.active = id;
      this.journal.attempt = undefined;
      this.journal.pending = undefined;
      await this.save();
      this.log("activation-ready", { bundleId: id });
    }
  }
  async rollback(reason: string) {
    const failed = this.current;
    if (failed !== "factory")
      this.journal.bad = [...new Set([...this.journal.bad, failed])].slice(
        -100,
      );
    this.current = this.journal.previous ?? "factory";
    this.journal.attempt = undefined;
    this.journal.pending = undefined;
    if (this.current !== "factory")
      try {
        await this.validate(this.current);
      } catch {
        this.current = "factory";
      }
    if (this.journal.bad.includes(this.current)) this.current = "factory";
    this.journal.active = this.current;
    await this.save().catch((error) =>
      this.log("rollback-journal-write-failed", { reason: String(error) }),
    );
    this.log("activation-rollback", { bundleId: failed, reason });
  }
  async prune() {
    // Keep active, previous and pending bundles; assets are retained until their full references are known.
    const { readdir } = await import("node:fs/promises");
    const keep = new Set([
      this.current,
      this.journal.active,
      this.journal.previous,
      this.journal.pending,
    ]);
    const hashes = new Set<string>();
    for (const id of await readdir(join(this.options.root, "manifests"))) {
      const key = id.replace(/\.json$/, "");
      if (keep.has(key)) {
        try {
          for (const f of (await this.manifest(key)).files)
            hashes.add(f.sha256);
        } catch {
          /* Invalid previous manifests cannot retain executable cache files. */
        }
      } else
        await rm(join(this.options.root, "manifests", id), { force: true });
    }
    for (const hash of await readdir(join(this.options.root, "assets")))
      if (!hashes.has(hash))
        await rm(join(this.options.root, "assets", hash), { force: true });
  }
  async resource(raw: string): Promise<Response> {
    try {
      const url = new URL(raw);
      if (
        url.protocol !== "app:" ||
        url.hostname !== "cinegather" ||
        url.username ||
        url.password ||
        url.port
      )
        return new Response("Forbidden", { status: 403 });
      const match = /^\/ui\/(factory|[a-f0-9]{64})\/(.+)$/.exec(
        decodeURIComponent(url.pathname),
      );
      if (!match) return new Response("Not found", { status: 404 });
      const [, id, path] = match;
      let bytes: Buffer;
      if (id === "factory") {
        const root = resolve(this.options.factory),
          file = resolve(root, path!);
        if (
          !file.startsWith(root + sep) ||
          !(await lstat(file)).isFile() ||
          (await lstat(file)).isSymbolicLink()
        )
          return new Response("Forbidden", { status: 403 });
        bytes = await readFile(file);
      } else {
        const f = (await this.manifest(id!)).files.find((f) => f.path === path);
        if (!f) return new Response("Not found", { status: 404 });
        bytes = await this.file(
          join(this.options.root, "assets", f.sha256),
          f.size,
          f.sha256,
        );
      }
      return new Response(new Uint8Array(bytes), {
        headers: {
          "Content-Type":
            mime[path!.split(".").pop()!] ?? "application/octet-stream",
          "Content-Security-Policy": csp,
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "no-store",
        },
      });
    } catch (e) {
      this.log("resource-failed", {
        reason: e instanceof Error ? e.message : "unknown",
      });
      return new Response("Resource unavailable", { status: 503 });
    }
  }
}
