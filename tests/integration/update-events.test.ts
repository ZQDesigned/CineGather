import { test, expect } from "bun:test";
import { mkdtemp, writeFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../apps/api/src/app";
import { readClientPolicy } from "../../apps/api/src/client-policy";
test("public update stream delivers policy and atomic release changes over one request, including to old clients", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cg-events-"));
  const app = await createApp({
    updateDirectory: directory,
    clientPolicy: readClientPolicy({ CLIENT_MIN_VERSION_WINDOWS: "0.1.7" }),
  });
  await app.listen(0, "127.0.0.1");
  const abort = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await fetch(
      `${await app.getUrl()}/api/v1/client-events?platform=win32&arch=x64`,
      {
        headers: {
          "X-CineGather-Platform": "win32",
          "X-CineGather-Version": "0.1.0",
        },
        signal: abort.signal,
      },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("x-accel-buffering")).toBe("no");
    reader = response.body!.getReader();
    let text = "";
    const until = async (value: string) => {
      while (!text.includes(value)) {
        const next = await reader!.read();
        if (next.done) throw Error("stream ended");
        text += new TextDecoder().decode(next.value);
      }
    };
    await until("event: policy");
    expect(text).toContain("0.1.7");
    const envelope = {
      payload: JSON.stringify({ version: "0.1.8", minimumVersion: "0.1.8" }),
      signature: "test-only",
    };
    await writeFile(join(directory, "staged.json"), JSON.stringify(envelope));
    await rename(
      join(directory, "staged.json"),
      join(directory, "win32-x64.json"),
    );
    await until("event: release");
    expect(text).toContain("0.1.8");
    expect(text.match(/event: release/g)).toHaveLength(1);
  } finally {
    abort.abort();
    await reader?.cancel().catch(() => {});
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 10000);

test("a signed push forces the updater and downloads in-room without requesting the version endpoint; forged pushes are ignored", async () => {
  const { generateKeyPairSync, sign, createHash } = await import("node:crypto");
  const { watchUpdateEvents } = await import(
    "../../packages/client-core/src/update-events"
  );
  const { UpdateController } = await import(
    "../../apps/desktop/src/main/update-controller"
  );
  const { verifyRelease } = await import(
    "../../apps/desktop/src/main/update-release"
  );
  const { automaticallyDownload } = await import(
    "../../apps/desktop/src/main/update-scheduler"
  );
  const directory = await mkdtemp(join(tmpdir(), "cg-signed-events-"));
  const app = await createApp({
    updateDirectory: directory,
    clientPolicy: readClientPolicy({}),
  });
  await app.listen(0, "127.0.0.1");
  const keys = generateKeyPairSync("ed25519");
  const key = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
  let connections = 0,
    versions = 0,
    pushes = 0,
    downloads = 0;
  const controller = new UpdateController(
    "install",
    "0.1.5",
    {
      latest: async () => {
        versions++;
        return null;
      },
      download: async () => {
        downloads++;
      },
      install: async () => {
        throw Error("must wait for consent");
      },
      cancel: () => {},
    },
    () => {
      void automaticallyDownload(controller, true);
    },
  );
  controller.setInRoom(true);
  const stop = watchUpdateEvents(
    `${await app.getUrl()}/api/v1/client-events?platform=win32&arch=x64`,
    (event, raw) => {
      if (event === "release") {
        pushes++;
        controller.acceptRelease(verifyRelease(raw, key, "win32", "x64"));
      }
    },
    async (input, init) => {
      connections++;
      return fetch(input, init);
    },
  );
  const until = async (test: () => boolean) => {
    const deadline = Date.now() + 5000;
    while (!test()) {
      if (Date.now() > deadline) throw Error("notification not delivered");
      await Bun.sleep(20);
    }
  };
  const release = {
    format: 1,
    platform: "win32",
    arch: "x64",
    version: "0.1.6",
    minimumVersion: "0.1.6",
    publishedAt: new Date().toISOString(),
    notes: "required",
    artifact: {
      file: "CineGather-0.1.6-win-x64-setup.exe",
      size: 4,
      sha512: createHash("sha512").update("test").digest("base64"),
    },
  };
  const payload = JSON.stringify(release),
    signature = sign(null, Buffer.from(payload), keys.privateKey).toString(
      "base64",
    );
  const publish = async (data: unknown) => {
    await writeFile(join(directory, "next.json"), JSON.stringify(data));
    await rename(
      join(directory, "next.json"),
      join(directory, "win32-x64.json"),
    );
  };
  try {
    await publish({ payload, signature: "invalid" });
    await until(() => pushes === 1);
    expect(controller.snapshot().required).not.toBe(true);
    expect(downloads).toBe(0);
    await publish({ payload, signature });
    await until(() => controller.snapshot().status === "downloaded");
    expect(controller.snapshot().required).toBe(true);
    expect(controller.snapshot().inRoom).toBe(true);
    expect(downloads).toBe(1);
    expect(versions).toBe(0);
    expect(connections).toBe(1);
  } finally {
    stop();
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 15000);
