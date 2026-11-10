import { test, expect } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { signDocument, verifyDocument, publishBundle, digest } from "./index";
const keys = generateKeyPairSync("ed25519");
const publicKey = keys.publicKey
  .export({ format: "pem", type: "spki" })
  .toString();
const privateKey = keys.privateKey
  .export({ format: "pem", type: "pkcs8" })
  .toString();
const identity = {
  platform: "darwin" as const,
  arch: "arm64" as const,
  runtime: "a".repeat(64),
};
test("rejects modified signed data and mismatched native runtime", () => {
  const document = {
    ...identity,
    format: 1,
    kind: "desktop-ui-policy",
    sequence: 1,
    revision: 1,
    bundleId: "b".repeat(64),
    minimumRevision: 0,
    featureMinimums: {},
    publishedAt: new Date().toISOString(),
    notes: "",
  };
  const raw = signDocument(document, privateKey);
  expect(verifyDocument(raw, publicKey, "policy", identity).revision).toBe(1);
  expect(() =>
    verifyDocument(
      raw.replace('\\"revision\\":1', '\\"revision\\":2'),
      publicKey,
      "policy",
      identity,
    ),
  ).toThrow();
  expect(() =>
    verifyDocument(raw, publicKey, "policy", {
      ...identity,
      runtime: "c".repeat(64),
    }),
  ).toThrow();
});
test("publication writes content-addressed assets and rejects native code and symlinks", async () => {
  const root = await mkdtemp(join(tmpdir(), "cg-publish-")),
    input = join(root, "input"),
    output = join(root, "output");
  await mkdir(input);
  await writeFile(join(input, "index.html"), "<div>healthy</div>");
  const result = await publishBundle({
    input,
    output,
    identity,
    revision: 1,
    sequence: 1,
    privateKey,
    minimumRevision: 0,
    featureMinimums: {},
    notes: "local",
  });
  const policy = verifyDocument(
    await readFile(
      join(output, `policies/darwin-arm64/${identity.runtime}.json`),
      "utf8",
    ),
    publicKey,
    "policy",
    identity,
  );
  expect(policy.bundleId).toBe(result.bundleId);
  const manifest = verifyDocument(
    await readFile(join(output, `manifests/${result.bundleId}.json`), "utf8"),
    publicKey,
    "manifest",
    identity,
  );
  expect(manifest.files[0]!.sha256).toBe(
    digest(Buffer.from("<div>healthy</div>")),
  );
  await writeFile(join(input, "evil.cjs"), "require('fs')");
  await expect(
    publishBundle({
      input,
      output,
      identity,
      revision: 2,
      sequence: 2,
      privateKey,
      minimumRevision: 0,
      featureMinimums: {},
      notes: "",
    }),
  ).rejects.toThrow();
});
test("manifests reject ambiguous, escaping and native paths before any publication becomes visible", async () => {
  const { desktopManifestSchema } = await import("@cinegather/contracts");
  const file = {
    path: "index.html",
    sha256: "a".repeat(64),
    size: 1,
    compressedSha256: "b".repeat(64),
    compressedSize: 1,
  };
  for (const path of [
    "../index.html",
    "assets/../../secret.js",
    "C:/evil.js",
    "assets\\evil.js",
    "resources/host.exe",
    "resources/addon.node",
    "CON.js",
  ]) {
    expect(() =>
      desktopManifestSchema.parse({
        ...identity,
        format: 1,
        kind: "desktop-ui",
        revision: 1,
        entry: "index.html",
        files: [file, { ...file, path }],
      }),
    ).toThrow();
  }
  expect(() =>
    desktopManifestSchema.parse({
      ...identity,
      format: 1,
      kind: "desktop-ui",
      revision: 1,
      entry: "index.html",
      files: [file, { ...file, path: "INDEX.html" }],
    }),
  ).toThrow();
  const { symlink, rm } = await import("node:fs/promises");
  const root = await mkdtemp(join(tmpdir(), "cg-symlink-"));
  await mkdir(join(root, "input"));
  await writeFile(join(root, "secret.js"), "secret");
  await symlink(join(root, "secret.js"), join(root, "input/index.html"));
  await expect(
    publishBundle({
      input: join(root, "input"),
      output: join(root, "output"),
      identity,
      privateKey,
      revision: 1,
      sequence: 1,
      minimumRevision: 0,
      featureMinimums: {},
      notes: "",
    }),
  ).rejects.toThrow();
  await rm(root, { recursive: true, force: true });
});
