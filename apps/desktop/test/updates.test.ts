import { test, expect } from "bun:test";
import { generateKeyPairSync, sign, createHash } from "node:crypto";
import {
  verifyRelease,
  newerVersion,
  updateMode,
  type Release,
} from "../src/main/update-release";
import { UpdateController } from "../src/main/update-controller";
const keys = generateKeyPairSync("ed25519");
const publicKey = keys.publicKey
  .export({ type: "spki", format: "pem" })
  .toString();
const release: Release = {
  format: 1,
  platform: "win32",
  arch: "x64",
  version: "0.1.3",
  publishedAt: "2026-10-24T00:00:00.000Z",
  notes: "改善麦克风体验",
  artifact: {
    file: "CineGather-0.1.3-win-x64-setup.exe",
    size: 4,
    sha512: createHash("sha512").update("test").digest("base64"),
  },
};
function envelope(value: unknown) {
  const payload = JSON.stringify(value);
  return JSON.stringify({
    payload,
    signature: sign(null, Buffer.from(payload), keys.privateKey).toString(
      "base64",
    ),
  });
}
test("only the expected platform and authenticated safe artifact are accepted", () => {
  expect(
    verifyRelease(envelope(release), publicKey, "win32", "x64").version,
  ).toBe("0.1.3");
  const tampered = JSON.parse(envelope(release));
  tampered.payload = tampered.payload.replace("0.1.3", "9.0.0");
  expect(() =>
    verifyRelease(JSON.stringify(tampered), publicKey, "win32", "x64"),
  ).toThrow();
  expect(() =>
    verifyRelease(envelope(release), publicKey, "darwin", "arm64"),
  ).toThrow();
  for (const file of [
    "https://evil.test/file.exe",
    "../evil.exe",
    "CineGather-0.1.3-win-x64-portable.exe",
  ])
    expect(() =>
      verifyRelease(
        envelope({ ...release, artifact: { ...release.artifact, file } }),
        publicKey,
        "win32",
        "x64",
      ),
    ).toThrow();
  expect(() =>
    verifyRelease(
      JSON.stringify({ payload: JSON.stringify(release) }),
      publicKey,
      "win32",
      "x64",
    ),
  ).toThrow();
});
test("stable version comparison prevents reinstall and downgrade", () => {
  expect(newerVersion("0.1.3", "0.1.2")).toBe(true);
  expect(newerVersion("0.1.10", "0.1.9")).toBe(true);
  expect(newerVersion("0.1.2", "0.1.2")).toBe(false);
  expect(newerVersion("0.1.1", "0.1.2")).toBe(false);
  expect(newerVersion("0.1.3-beta", "0.1.2")).toBe(false);
});
test("portable and unpacked builds never enable automatic update installation", () => {
  expect(updateMode("win32", true, true, false)).toBe("install");
  expect(updateMode("win32", true, true, true)).toBe("disabled");
  expect(updateMode("win32", true, false, false)).toBe("disabled");
  expect(updateMode("darwin", true, false, false)).toBe("notify");
  expect(updateMode("darwin", false, false, false)).toBe("disabled");
});
function setup(mode: "install" | "notify" | "disabled" = "install") {
  const calls: string[] = [];
  let finish!: () => void;
  const transport = {
    latest: async () => {
      calls.push("check");
      return release as ReturnType<typeof verifyRelease>;
    },
    download: async (_release: unknown, progress: (value: number) => void) => {
      calls.push("download");
      progress(42);
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    },
    install: async () => {
      calls.push("install");
    },
    cancel: () => {
      calls.push("cancel");
      finish?.();
    },
  };
  const controller = new UpdateController(mode, "0.1.2", transport, () => {});
  return { controller, calls, finish: () => finish(), transport };
}
test("a room permits downloading but installation waits until the room has been left", async () => {
  const s = setup();
  s.controller.setInRoom(true);
  await s.controller.check();
  const downloading = s.controller.download();
  await Promise.resolve();
  expect(s.controller.snapshot().progress).toBe(42);
  await s.controller.check();
  expect(s.calls.filter((x) => x === "check")).toHaveLength(1);
  s.finish();
  await downloading;
  expect(s.controller.snapshot().status).toBe("downloaded");
  await expect(s.controller.install()).rejects.toThrow();
  s.controller.setInRoom(false);
  await s.controller.install();
  expect(s.calls).toEqual(["check", "download", "install"]);
});
test("entering a room keeps its ongoing download and finishing it never installs automatically", async () => {
  const s = setup();
  await s.controller.check();
  const pending = s.controller.download();
  await Promise.resolve();
  s.controller.setInRoom(true);
  expect(s.calls).not.toContain("cancel");
  s.finish();
  await pending;
  expect(s.controller.snapshot().status).toBe("downloaded");
  expect(s.calls).not.toContain("install");
});
test("a pushed cutoff is observed even with an already downloaded version", async () => {
  const s = setup();
  await s.controller.check();
  const pending = s.controller.download();
  await Promise.resolve();
  s.finish();
  await pending;
  s.controller.acceptRelease({
    ...release,
    version: "0.1.4",
    minimumVersion: "0.1.4",
    artifact: {
      ...release.artifact,
      file: "CineGather-0.1.4-win-x64-setup.exe",
    },
  });
  expect(s.controller.snapshot().required).toBe(true);
  expect(s.controller.snapshot().latestVersion).toBe("0.1.4");
  expect(s.controller.snapshot().status).toBe("available");
});
test("periodic checks can observe a new required release without discarding the downloaded candidate on network failure", async () => {
  const s = setup();
  await s.controller.check();
  const d = s.controller.download();
  await Promise.resolve();
  s.finish();
  await d;
  s.transport.latest = async () => {
    throw Error("offline");
  };
  await s.controller.check();
  expect(s.controller.snapshot().status).toBe("downloaded");
  expect(s.controller.snapshot().latestVersion).toBe("0.1.3");
  s.transport.latest = async () => ({ ...release, minimumVersion: "0.1.3" });
  await s.controller.check();
  expect(s.controller.snapshot().required).toBe(true);
  expect(s.controller.snapshot().status).toBe("downloaded");
});
test("macOS is notification-only and disabled targets do not contact the feed", async () => {
  const mac = setup("notify");
  await mac.controller.check();
  expect(mac.controller.snapshot().status).toBe("available");
  await expect(mac.controller.download()).rejects.toThrow();
  await expect(mac.controller.install()).rejects.toThrow();
  expect(mac.calls).toEqual(["check"]);
  const disabled = setup("disabled");
  await disabled.controller.check();
  expect(disabled.calls).toEqual([]);
});
test("network error is retryable and never enables installation", async () => {
  const s = setup();
  let failed = true;
  s.transport.latest = async () => {
    if (failed) throw new Error("network");
    return release as ReturnType<typeof verifyRelease>;
  };
  await s.controller.check();
  expect(s.controller.snapshot().status).toBe("error");
  await expect(s.controller.install()).rejects.toThrow();
  failed = false;
  await s.controller.check();
  expect(s.controller.snapshot().status).toBe("available");
});

test("downloaded bytes must still match signed metadata immediately before execution", async () => {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { verifyInstaller } = await import("../src/main/update-release");
  const dir = await mkdtemp(join(tmpdir(), "cg-update-"));
  const file = join(dir, "setup.exe");
  try {
    await writeFile(file, "test");
    await verifyInstaller(file, release.artifact);
    await writeFile(file, "evil");
    await expect(verifyInstaller(file, release.artifact)).rejects.toThrow();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("release CLI output is accepted by the real verifier", async () => {
  const { signRelease } = await import("../../../tools/update-release");
  const raw = signRelease(
    release,
    keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  );
  expect(verifyRelease(raw, publicKey, "win32", "x64").artifact.size).toBe(4);
  const other = generateKeyPairSync("ed25519");
  expect(() =>
    verifyRelease(
      raw,
      other.publicKey.export({ type: "spki", format: "pem" }).toString(),
      "win32",
      "x64",
    ),
  ).toThrow();
});
test("feed requests are bounded, refuse redirects and accept only signed responses", async () => {
  const { fetchRelease } = await import("../src/main/update-release");
  let options: RequestInit | undefined;
  const request = (async (_url: unknown, init: RequestInit) => {
    options = init;
    return new Response(envelope(release));
  }) as typeof fetch;
  expect(
    (await fetchRelease(publicKey, "win32", "x64", request))?.version,
  ).toBe("0.1.3");
  expect(options?.redirect).toBe("error");
  expect(options?.signal).toBeInstanceOf(AbortSignal);
  const oversized = (async () =>
    new Response("a".repeat(70000))) as unknown as typeof fetch;
  await expect(
    fetchRelease(publicKey, "win32", "x64", oversized),
  ).rejects.toThrow();
  const missing = (async () =>
    new Response(null, { status: 404 })) as unknown as typeof fetch;
  expect(await fetchRelease(publicKey, "win32", "x64", missing)).toBeNull();
});

test("the NSIS provider keeps the exact signed release when callers mutate their copy", async () => {
  const { SignedReleaseProvider } = await import("../src/main/update-provider");
  const copy = structuredClone(release);
  const provider = new SignedReleaseProvider(
    {
      provider: "custom",
      updateProvider: SignedReleaseProvider,
      release: copy,
    } as import("builder-util-runtime").CustomPublishOptions,
    undefined,
    { platform: "win32", isUseMultipleRangeRequest: false, executor: null! },
  );
  copy.version = "99.0.0";
  const info = await provider.getLatestVersion();
  expect(info.version).toBe("0.1.3");
  expect(provider.resolveFiles(info)[0]?.url.href).toBe(
    "https://cgplat.zqdesigned.city/downloads/CineGather-0.1.3-win-x64-setup.exe",
  );
  expect(info.files[0]?.sha512).toBe(release.artifact.sha512);
});
test("an update check cannot replace a release while its cancelled download is still settling", async () => {
  const s = setup();
  await s.controller.check();
  const pending = s.controller.download();
  await Promise.resolve();
  s.transport.cancel = () => {
    s.calls.push("cancel");
  };
  s.controller.setInRoom(true);
  s.controller.setInRoom(false);
  await s.controller.check();
  expect(s.calls.filter((value) => value === "check")).toHaveLength(1);
  s.finish();
  await pending;
});

test("Windows transport validates the installer again before handing execution to NSIS", async () => {
  const { windowsDownloader } = await import("../src/main/windows-update");
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "cg-nsis-"));
  const file = join(dir, "setup.exe");
  const calls: string[] = [];
  const updater = {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    allowDowngrade: true,
    allowPrerelease: true,
    disableWebInstaller: false,
    setFeedURL: () => {},
    checkForUpdates: async () => ({ updateInfo: { version: "0.1.3" } }),
    downloadUpdate: async () => [file],
    on: () => {},
    removeListener: () => {},
    quitAndInstall: () => {
      calls.push("install");
    },
  };
  const downloader = windowsDownloader(updater, async () => {
    calls.push("cleanup");
  });
  try {
    await writeFile(file, "test");
    await downloader.download(release, () => {});
    await writeFile(file, "evil");
    await expect(downloader.install()).rejects.toThrow();
    expect(calls).toEqual([]);
    await writeFile(file, "test");
    await downloader.install();
    expect(calls).toEqual(["cleanup", "install"]);
    expect(updater.autoDownload).toBe(false);
    expect(updater.autoInstallOnAppQuit).toBe(false);
    expect(updater.disableWebInstaller).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cancelling during the NSIS pre-download check prevents subsequent network download", async () => {
  const { windowsDownloader } = await import("../src/main/windows-update");
  let checked!: () => void;
  let downloads = 0;
  const updater = {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    allowDowngrade: true,
    allowPrerelease: true,
    disableWebInstaller: false,
    setFeedURL: () => {},
    checkForUpdates: async () => {
      await new Promise<void>((resolve) => {
        checked = resolve;
      });
      return { updateInfo: { version: "0.1.3" } };
    },
    downloadUpdate: async () => {
      downloads++;
      return [];
    },
    on: () => {},
    removeListener: () => {},
    quitAndInstall: () => {},
  };
  const downloader = windowsDownloader(updater, async () => {});
  const pending = downloader.download(release, () => {});
  downloader.cancel();
  checked();
  await expect(pending).rejects.toThrow();
  expect(downloads).toBe(0);
});

test("a failed recheck does not leave an unusable download action from a previous result", async () => {
  const s = setup();
  await s.controller.check();
  expect(s.controller.snapshot().latestVersion).toBe("0.1.3");
  s.transport.latest = async () => {
    throw new Error("offline");
  };
  await s.controller.check();
  expect(s.controller.snapshot().latestVersion).toBeUndefined();
  expect(s.controller.downloadURL()).toBeUndefined();
});

test("signed minimum version forces only incompatible clients and survives a failed recheck", async () => {
  const required = verifyRelease(
    envelope({ ...release, minimumVersion: "0.1.3", reason: "共享协议已升级" }),
    publicKey,
    "win32",
    "x64",
  );
  const s = setup();
  s.transport.latest = async () => required;
  await s.controller.check();
  expect(s.controller.snapshot().required).toBe(true);
  expect(s.controller.snapshot().minimumVersion).toBe("0.1.3");
  expect(() => s.controller.setInRoom(true)).toThrow();
  s.transport.latest = async () => {
    throw new Error("offline");
  };
  await s.controller.check();
  expect(s.controller.snapshot().required).toBe(true);
  expect(() =>
    verifyRelease(
      envelope({ ...release, minimumVersion: "0.1.4" }),
      publicKey,
      "win32",
      "x64",
    ),
  ).toThrow();
  const normal = setup();
  await normal.controller.check();
  expect(normal.controller.snapshot().required).not.toBe(true);
});
test("server-required update cannot install a downloaded release below the required cutoff", async () => {
  const s = setup();
  await s.controller.check();
  const download = s.controller.download();
  await Promise.resolve();
  s.finish();
  await download;
  s.controller.requireUpdate("0.1.4", "服务器需要更新客户端");
  await expect(s.controller.install()).rejects.toThrow();
  expect(s.calls).not.toContain("install");
});

test("raising the cutoff discards an obsolete cached update and allows checking for its replacement", async () => {
  const s = setup();
  await s.controller.check();
  const download = s.controller.download();
  await Promise.resolve();
  s.finish();
  await download;
  s.controller.requireUpdate("0.1.4", "需要新协议");
  s.transport.latest = async () => ({
    ...release,
    version: "0.1.4",
    artifact: {
      ...release.artifact,
      file: "CineGather-0.1.4-win-x64-setup.exe",
    },
  });
  await s.controller.check();
  expect(s.controller.snapshot().latestVersion).toBe("0.1.4");
  expect(s.controller.snapshot().status).toBe("available");
});

test("a compatibility cutoff raised during installation preparation prevents execution of the obsolete installer", async () => {
  const { windowsDownloader } = await import("../src/main/windows-update");
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "cg-install-cutoff-"));
  const file = join(dir, "setup.exe");
  let allowed = true,
    installed = false;
  const updater = {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    allowDowngrade: true,
    allowPrerelease: true,
    disableWebInstaller: false,
    setFeedURL: () => {},
    checkForUpdates: async () => ({ updateInfo: { version: "0.1.3" } }),
    downloadUpdate: async () => [file],
    on: () => {},
    removeListener: () => {},
    quitAndInstall: () => {
      installed = true;
    },
  };
  const transport = windowsDownloader(updater, async () => {
    allowed = false;
  });
  try {
    await writeFile(file, "test");
    await transport.download(release, () => {});
    await expect(transport.install(() => allowed)).rejects.toThrow();
    expect(installed).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("conflicting reasons for the same mandatory version cannot ping-pong update state or disturb a download", async () => {
  let changes = 0;
  const controller = new UpdateController(
    "install",
    "0.1.2",
    {
      latest: async () => release,
      cancel: () => {
        throw new Error("usable download cancelled");
      },
      download: async () => {},
      install: async () => {},
    },
    () => {
      changes++;
    },
  );
  controller.requireUpdate("0.1.3", "服务端说明");
  for (let i = 0; i < 100; i++)
    controller.requireUpdate("0.1.3", i % 2 ? "服务端说明" : "清单说明");
  expect(changes).toBe(1);
  expect(controller.snapshot().reason).toBe("服务端说明");
  controller.requireUpdate("0.1.4", "下一次升级");
  expect(changes).toBe(2);
  expect(controller.snapshot().minimumVersion).toBe("0.1.4");
});

test("same-cutoff metadata changes preserve an in-flight installer and its progress", async () => {
  const s = setup();
  await s.controller.check();
  s.controller.requireUpdate("0.1.3", "服务端说明");
  const downloading = s.controller.download();
  await Promise.resolve();
  const before = s.controller.snapshot();
  for (let i = 0; i < 20; i++) {
    s.controller.requireUpdate("0.1.3", i % 2 ? "服务端说明" : "清单说明");
    expect(s.controller.snapshot()).toEqual(before);
  }
  expect(s.calls.filter((c) => c === "cancel")).toEqual([]);
  s.finish();
  await downloading;
  expect(s.controller.snapshot().status).toBe("downloaded");
});

test("installation diagnostics distinguish verification, cleanup and handoff failures while preserving installation behavior", async () => {
  const { windowsDownloader } = await import("../src/main/windows-update");
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "cg-update-trace-")),
    file = join(dir, "setup.exe");
  const phases: string[] = [];
  let fail = true,
    installed = false;
  const updater = {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    allowDowngrade: false,
    allowPrerelease: false,
    disableWebInstaller: true,
    setFeedURL: () => {},
    checkForUpdates: async () => ({ updateInfo: { version: release.version } }),
    downloadUpdate: async () => [file],
    on: () => {},
    removeListener: () => {},
    quitAndInstall: () => {
      installed = true;
    },
  };
  const d = windowsDownloader(
    updater,
    async () => {
      if (fail)
        throw Object.assign(new Error("private"), { code: "CLEANUP_FAILED" });
    },
    undefined,
    (phase) => phases.push(phase),
  );
  try {
    await writeFile(file, "test");
    await d.download(release, () => {});
    await expect(d.install()).rejects.toThrow();
    expect(installed).toBe(false);
    expect(phases).toContain("cleanup-failed");
    expect(phases).not.toContain("installer-handoff");
    fail = false;
    await d.install();
    expect(phases).toContain("installer-verified");
    expect(phases).toContain("cleanup-complete");
    expect(phases).toContain("installer-handoff");
    expect(installed).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
