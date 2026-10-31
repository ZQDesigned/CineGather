import { test, expect } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { generateKeyPairSync, verify } from "node:crypto";
import { createApp } from "../../apps/api/src/app";
import { readClientPolicy } from "../../apps/api/src/client-policy";
import { publishMobileUpdate } from "../../tools/mobile-publish";
test("old mobile clients can obtain signed OTA while business requests enforce both version floors", async () => {
  const dir = await mkdtemp("/tmp/cg-mobile-http-");
  const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const exp = join(dir, "export"),
    store = join(dir, ".updates");
  await mkdir(exp);
  await writeFile(join(exp, "index.hbc"), "test OTA");
  await writeFile(
    join(exp, "metadata.json"),
    JSON.stringify({
      fileMetadata: { android: { bundle: "index.hbc", assets: [] } },
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
  await publishMobileUpdate({
    exportDirectory: exp,
    storeDirectory: store,
    privateKey: keys.privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString(),
    certificate: keys.publicKey
      .export({ type: "spki", format: "pem" })
      .toString(),
    origin: "https://cgplat.zqdesigned.city",
    minimumRevision: 2,
    notes: "协议更新",
  });
  const app = await createApp({
    updateDirectory: store,
    clientPolicy: readClientPolicy({}),
  });
  await app.listen(0, "127.0.0.1");
  const url = await app.getUrl();
  try {
    const headers = {
      "X-CineGather-Platform": "android",
      "X-CineGather-Version": "0.1.26",
      "X-CineGather-Build": "2",
      "X-CineGather-Runtime": "native-v1",
      "X-CineGather-Revision": "1",
    };
    const policy = await fetch(
      url + "/api/v1/mobile-updates/policy?platform=android&runtime=native-v1",
      { headers },
    );
    expect(policy.status).toBe(200);
    expect(policy.headers.get("cache-control")).toBe("no-store");
    const blocked = await fetch(url + "/api/v1/registration", { headers });
    expect(blocked.status).toBe(426);
    expect(blocked.headers.get("x-cinegather-mobile-update")).toBe("hot");
    const okay = await fetch(url + "/api/v1/registration", {
      headers: { ...headers, "X-CineGather-Revision": "2" },
    });
    expect(okay.status).toBe(200);
    const manifestResponse = await fetch(
      url + "/api/v1/mobile-updates/manifest",
      {
        headers: {
          "expo-protocol-version": "1",
          "expo-platform": "android",
          "expo-runtime-version": "native-v1",
          accept: "application/expo+json, multipart/mixed",
        },
      },
    );
    expect(manifestResponse.status).toBe(200);
    const body = await manifestResponse.text();
    const signature = /sig="([^"]+)"/.exec(
      manifestResponse.headers.get("expo-signature")!,
    )![1]!;
    expect(
      verify(
        "sha256",
        Buffer.from(body),
        keys.publicKey,
        Buffer.from(signature, "base64"),
      ),
    ).toBe(true);
    const hash = new URL(JSON.parse(body).launchAsset.url).pathname
      .split("/")
      .at(-1);
    const asset = await fetch(url + "/api/v1/mobile-updates/assets/" + hash);
    expect(await asset.text()).toBe("test OTA");
    expect(asset.headers.get("cache-control")).toContain("immutable");
    const missing = await fetch(
      url + "/api/v1/mobile-updates/assets/" + "0".repeat(64),
    );
    expect(missing.status).toBe(404);
    expect(missing.headers.get("cache-control")).toBe("no-store");
    const absent = await fetch(url + "/api/v1/mobile-updates/manifest", {
      headers: {
        "expo-protocol-version": "1",
        "expo-platform": "android",
        "expo-runtime-version": "different",
        accept: "multipart/mixed",
      },
    });
    expect(absent.status).toBe(204);
    const leave = await fetch(
      url + "/api/v1/rooms/00000000-0000-4000-8000-000000000001/leave",
      { method: "POST", headers },
    );
    expect(leave.status).not.toBe(426);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
