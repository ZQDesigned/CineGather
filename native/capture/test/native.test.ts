import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
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
