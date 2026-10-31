import { test, expect } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { generateKeyPairSync, verify, createHash } from "node:crypto";
import { publishMobileUpdate } from "../../../tools/mobile-publish";
test("publishing signs Expo manifests and hashes assets before atomically advancing the policy", async () => {
  const root = await mkdtemp("/tmp/cg-ota-publish-");
  const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const privateKey = keys.privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString(),
    certificate = keys.publicKey
      .export({ type: "spki", format: "pem" })
      .toString();
  try {
    const exp = join(root, "export"),
      store = join(root, "store");
    await mkdir(join(exp, "assets"), { recursive: true });
    await writeFile(join(exp, "bundle.hbc"), "fake Hermes bundle");
    await writeFile(join(exp, "assets/picture"), "image bytes");
    await writeFile(
      join(exp, "metadata.json"),
      JSON.stringify({
        fileMetadata: {
          android: {
            bundle: "bundle.hbc",
            assets: [{ path: "assets/picture", ext: "png" }],
          },
        },
      }),
    );
    await writeFile(
      join(exp, "cinegather-export.json"),
      JSON.stringify({
        platform: "android",
        channel: "stable",
        runtime: "native-v1",
        revision: 2,
        version: "0.1.27",
        nativeBuild: 2,
        nativeVersion: "0.1.26",
        expoClient: {
          extra: {
            mobileUpdate: { revision: 2, version: "0.1.27", channel: "stable" },
          },
        },
      }),
    );
    const options = {
      exportDirectory: exp,
      storeDirectory: store,
      privateKey,
      certificate,
      origin: "https://cgplat.zqdesigned.city",
      minimumRevision: 2,
      notes: "热更新修复",
    };
    const result = await publishMobileUpdate(options);
    const envelope = JSON.parse(
      await readFile(
        join(store, "mobile/manifests", result.updateId + ".json"),
        "utf8",
      ),
    );
    expect(
      verify(
        "sha256",
        Buffer.from(envelope.manifest),
        certificate,
        Buffer.from(envelope.signature, "base64"),
      ),
    ).toBe(true);
    const manifest = JSON.parse(envelope.manifest);
    expect(manifest.runtimeVersion).toBe("native-v1");
    expect(manifest.extra.expoClient.extra.mobileUpdate.revision).toBe(2);
    const hash = createHash("sha256")
      .update("fake Hermes bundle")
      .digest("hex");
    expect(manifest.launchAsset.url).toEndWith(hash);
    expect(await readFile(join(store, "mobile/assets", hash), "utf8")).toBe(
      "fake Hermes bundle",
    );
    const policy = JSON.parse(
      await readFile(join(store, "mobile/stable/android.json"), "utf8"),
    );
    expect(policy.runtimes[0].minimumRevision).toBe(2);
    await expect(publishMobileUpdate(options)).rejects.toThrow();
    const descriptor = JSON.parse(
      await readFile(join(exp, "cinegather-export.json"), "utf8"),
    );
    descriptor.revision = 3;
    descriptor.expoClient.extra.mobileUpdate.revision = 3;
    await writeFile(
      join(exp, "cinegather-export.json"),
      JSON.stringify(descriptor),
    );
    const concurrent = await Promise.allSettled([
      publishMobileUpdate(options),
      publishMobileUpdate(options),
    ]);
    expect(concurrent.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(concurrent.filter((r) => r.status === "rejected")).toHaveLength(1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the bundled OTA trust certificate is valid for code signing on native clients", async () => {
  const { X509Certificate } = await import("node:crypto");
  const certificate = new X509Certificate(
    await readFile(
      new URL("../../mobile/resources/update-certificate.pem", import.meta.url),
    ),
  );
  expect(certificate.keyUsage).toContain("1.3.6.1.5.5.7.3.3");
  expect(certificate.ca).toBe(false);
});
