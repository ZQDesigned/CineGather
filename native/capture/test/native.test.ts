import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("media clock conversion remains exact across an hour and RTP wrap", () => {
  const bin = join(mkdtempSync(join(tmpdir(), "cg-timing-")), "timing");
  const build = spawnSync("clang++", [
    "-std=c++17",
    "native/capture/test/timing.cpp",
    "-o",
    bin,
  ]);
  expect(build.status).toBe(0);
  expect(spawnSync(bin).status).toBe(0);
});

test("system audio excludes CineGather and its helper family without excluding unrelated players", () => {
  const bin = join(
    mkdtempSync(join(tmpdir(), "cg-audio-policy-")),
    "exclusions",
  );
  const build = spawnSync("clang++", [
    "-std=c++17",
    "native/capture/test/audio-exclusions.cpp",
    "-o",
    bin,
  ]);
  expect(build.status).toBe(0);
  expect(spawnSync(bin).status).toBe(0);
});

test("manual native encoder selection preserves adapter identity and never falls back", () => {
  const bin = join(
    mkdtempSync(join(tmpdir(), "cg-encoder-policy-")),
    "selection",
  );
  expect(
    spawnSync("clang++", [
      "-std=c++17",
      "native/capture/test/encoder-selection.cpp",
      "-o",
      bin,
    ]).status,
  ).toBe(0);
  expect(spawnSync(bin).status).toBe(0);
});

test("local preview preserves every original packet at 60fps and bounds slow receivers", () => {
  const bin = join(mkdtempSync(join(tmpdir(), "cg-preview-queue-")), "preview");
  expect(
    spawnSync("clang++", [
      "-std=c++17",
      "native/capture/test/preview-queue.cpp",
      "-o",
      bin,
    ]).status,
  ).toBe(0);
  expect(spawnSync(bin).status).toBe(0);
});

test("native HTTP trace preserves numeric errors, stage timing and cleanup separation", async () => {
  const root = mkdtempSync(join(tmpdir(), "cg-network-trace-")),
    bin = join(root, "network");
  const build = spawnSync("clang++", [
    "-std=c++17",
    "native/capture/test/network-diagnostics.cpp",
    "-lcurl",
    "-o",
    bin,
  ]);
  expect(build.status, build.stderr.toString()).toBe(0);
  expect(spawnSync(bin).status).toBe(0);
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      if (new URL(req.url).pathname === "/timeout") await Bun.sleep(300);
      return new Response("synthetic", { status: 201 });
    },
  });
  try {
    for (const path of ["/ok", "/timeout"]) {
      const child = Bun.spawn(
        [
          bin,
          `http://127.0.0.1:${server.port}${path}`,
          ...(path === "/timeout" ? ["timeout"] : []),
        ],
        { stdout: "pipe", stderr: "pipe" },
      );
      expect(await child.exited, await new Response(child.stderr).text()).toBe(
        0,
      );
      const record = JSON.parse(await new Response(child.stdout).text());
      expect(record.curlCode).toBe(path === "/timeout" ? 28 : 0);
      expect(record.wallUs).toBeGreaterThan(0);
      expect(record.tlsUs).toBe(-1);
    }
  } finally {
    server.stop(true);
    rmSync(root, { recursive: true, force: true });
  }
});

test("native HTTP trace separates connection refusal from TLS certificate rejection without raw errors", async () => {
  const root = mkdtempSync(join(tmpdir(), "cg-network-errors-")),
    bin = join(root, "network");
  let tls: ReturnType<typeof Bun.serve> | undefined;
  try {
    const build = spawnSync("clang++", [
      "-std=c++17",
      "native/capture/test/network-diagnostics.cpp",
      "-lcurl",
      "-o",
      bin,
    ]);
    expect(build.status, build.stderr.toString()).toBe(0);
    const cert = join(root, "cert.pem"),
      key = join(root, "key.pem");
    expect(
      spawnSync("openssl", [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        key,
        "-out",
        cert,
        "-days",
        "1",
        "-subj",
        "/CN=synthetic.invalid",
      ]).status,
    ).toBe(0);
    tls = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      tls: { key: readFileSync(key), cert: readFileSync(cert) },
      fetch: () => new Response("fixture", { status: 201 }),
    });
    const unused = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => new Response(),
    });
    const port = unused.port;
    unused.stop(true);
    for (const [url, code] of [
      [`http://127.0.0.1:${port}/`, 7],
      [`https://127.0.0.1:${tls.port}/`, 60],
    ] as const) {
      const child = Bun.spawn([bin, url, String(code)], {
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(await child.exited, await new Response(child.stderr).text()).toBe(
        0,
      );
      const output = await new Response(child.stdout).text(),
        record = JSON.parse(output);
      expect(record.curlCode).toBe(code);
      expect(record.firstByteUs).toBe(-1);
      expect(output).not.toMatch(
        /127\.0\.0\.1|synthetic|https|certificate|error_buffer/,
      );
      if (code === 7) expect(record.osError).toBeGreaterThan(0);
      if (code === 60) expect(record.tlsUs).toBe(-1);
    }
  } finally {
    tls?.stop(true);
    rmSync(root, { recursive: true, force: true });
  }
});
