import { expect, test } from "bun:test";
import { nativeProgressSchema } from "@cinegather/contracts";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("production HWND size callbacks stay responsive while the video thread holds graphics, and track resizing/minimize", () => {
  const root = mkdtempSync(join(tmpdir(), "cg-window-status-"));
  try {
    const host = readFileSync("native/capture/windows-host.cpp", "utf8");
    const callbacks = host.slice(
      host.indexOf("struct ExactWindow {"),
      host.indexOf("static HMONITOR monitorHandle"),
    );
    const progress = host.includes('#include "capture-progress.hpp"')
      ? '#include "capture-progress.hpp"\nstatic cinegather::CaptureProgress progress([](const std::string &) {});\nusing Stage = cinegather::CaptureProgress::Stage;\n'
      : "";
    const fixture = readFileSync(
      "native/capture/test/window-status.cpp",
      "utf8",
    ).replace("PRODUCTION_CALLBACKS", progress + callbacks);
    writeFileSync(join(root, "fixture.cpp"), fixture);
    const build = spawnSync("clang++", [
      "-std=c++17",
      "-Werror=switch",
      "-pthread",
      "-I",
      resolve("native/capture"),
      join(root, "fixture.cpp"),
      "-o",
      join(root, "fixture"),
    ]);
    expect(build.status, build.stderr.toString()).toBe(0);
    const run = spawnSync(join(root, "fixture"), [], { timeout: 3000 });
    expect(
      run.status,
      "19 means status was blocked by the render-thread graphics lock",
    ).toBe(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("watchdog progress records graphics wait/acquisition/hold/failure without needing the graphics lock", () => {
  const root = mkdtempSync(join(tmpdir(), "cg-capture-progress-"));
  try {
    const build = spawnSync("clang++", [
      "-std=c++17",
      "-Werror=switch",
      "-pthread",
      "native/capture/test/capture-progress.cpp",
      "-o",
      join(root, "fixture"),
    ]);
    expect(build.status, build.stderr.toString()).toBe(0);
    const run = spawnSync(join(root, "fixture"), [], { timeout: 5000 });
    expect(run.status, run.stderr.toString()).toBe(0);
    const events = run.stdout
      .toString()
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    for (const event of events)
      expect(nativeProgressSchema.safeParse(event).success).toBe(true);
    expect(
      events.find(
        (e) => e.stage === "window-init-graphics" && e.state === "waiting",
      ),
    ).toMatchObject({
      elapsedMs: 600,
      command: "start",
      sourceKind: "window",
      commandSequence: 1,
    });
    expect(
      events.find(
        (e) => e.stage === "window-init-graphics" && e.state === "acquired",
      ),
    ).toMatchObject({ waitMs: 900 });
    expect(
      events.find(
        (e) => e.stage === "window-init-graphics" && e.state === "held",
      ),
    ).toMatchObject({ elapsedMs: 1900, waitMs: 900 });
    expect(
      events.find((e) => e.stage === "scene-create" && e.state === "failed"),
    ).toBeDefined();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("production start ACK does not execute the graphics-dependent status snapshot", () => {
  const root = mkdtempSync(join(tmpdir(), "cg-start-ack-"));
  try {
    const host = readFileSync(
      process.env.CG_TEST_HOST_SOURCE ?? "native/capture/windows-host.cpp",
      "utf8",
    );
    const handler = host.slice(host.indexOf("static Data handle("));
    const branch = handler.slice(
      handler.indexOf('  if (type == "start") {'),
      handler.indexOf('  throw std::runtime_error("unknown-command")'),
    );
    writeFileSync(
      join(root, "fixture.cpp"),
      readFileSync("native/capture/test/start-ack.cpp", "utf8").replace(
        "PRODUCTION_START",
        branch,
      ),
    );
    const build = spawnSync("clang++", [
      "-std=c++17",
      "-Werror=switch",
      "-I",
      resolve("native/capture"),
      join(root, "fixture.cpp"),
      "-o",
      join(root, "fixture"),
    ]);
    expect(build.status, build.stderr.toString()).toBe(0);
    const run = spawnSync(join(root, "fixture"), [], { timeout: 3000 });
    expect(
      run.status,
      "21 means start called the blocking status snapshot before acknowledging",
    ).toBe(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
