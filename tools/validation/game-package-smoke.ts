import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { strict as assert } from "node:assert";
const directory = resolve(process.argv[2]!);
const executable = join(
  directory,
  "cinegather-game-link" + (process.platform === "win32" ? ".exe" : ""),
);
const runtime = JSON.parse(
  await readFile(join(directory, "runtime.json"), "utf8"),
);
assert.equal(runtime.version, "0.71.0");
assert.equal(
  runtime.sha256,
  createHash("sha256")
    .update(await readFile(executable))
    .digest("hex"),
);
assert.match(
  await readFile(join(directory, "THIRD_PARTY_NOTICES.txt"), "utf8"),
  /github.com\/fatedier\/frp@v0\.71\.0/,
);
const result = spawnSync(executable, [], {
  input: JSON.stringify({ id: "release-probe", version: 1, op: "stop" }) + "\n",
  timeout: 10000,
  encoding: "utf8",
});
assert.equal(result.error, undefined);
assert.equal(result.status, 0);
const messages = result.stdout
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));
assert(messages.some((m) => m.id === "release-probe" && m.ok === true));
assert.equal(result.stderr, "");
console.log(
  JSON.stringify({
    engine: runtime.version,
    nativeIPC: true,
    digestVerified: true,
    licensesVerified: true,
  }),
);
