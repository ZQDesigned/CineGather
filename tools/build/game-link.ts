import { resolve, join } from "node:path";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const root = resolve(import.meta.dir, "../.."),
  go = process.env.CG_GO ?? "go",
  server = process.argv.includes("--server");
const targets = process.argv.includes("--all")
  ? [
      { platform: "darwin", os: "darwin", arch: "arm64" },
      { platform: "win32", os: "windows", arch: "amd64" },
    ]
  : [
      {
        platform: process.platform,
        os: process.platform === "win32" ? "windows" : process.platform,
        arch: process.arch === "x64" ? "amd64" : process.arch,
      },
    ];
for (const target of targets) {
  if (
    !["darwin", "windows"].includes(target.os) &&
    !(target.os === "linux" && process.argv.includes("--test-host"))
  )
    throw Error("Game link supports Windows x64 and macOS arm64");
  const directory = join(
    root,
    ".local/native-runtime/game-link",
    `${target.platform}-${target.arch === "amd64" ? "x64" : target.arch}`,
  );
  await mkdir(directory, { recursive: true });
  const output = join(
    directory,
    "cinegather-game-link" + (target.os === "windows" ? ".exe" : ""),
  );
  const child = Bun.spawn(
    [
      go,
      "build",
      "-tags",
      "noweb",
      "-trimpath",
      "-ldflags=-s -w",
      "-o",
      output,
      ".",
    ],
    {
      cwd: join(root, "native/game-link"),
      env: {
        ...process.env,
        CGO_ENABLED: "0",
        GOOS: target.os,
        GOARCH: target.arch,
      },
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  if (await child.exited) throw Error("Game link build failed");
  const modules = Bun.spawn(
    [
      go,
      "list",
      "-deps",
      "-f",
      "{{if .Module}}{{.Module.Path}}\t{{.Module.Version}}\t{{.Module.Dir}}{{end}}",
      ".",
    ],
    {
      cwd: join(root, "native/game-link"),
      env: { ...process.env, GOOS: target.os, GOARCH: target.arch },
      stdout: "pipe",
      stderr: "inherit",
    },
  );
  const inventory = await new Response(modules.stdout).text();
  if (await modules.exited)
    throw Error("Unable to inventory game runtime licenses");
  const notices: string[] = [];
  for (const line of new Set(inventory.split("\n").filter(Boolean))) {
    const [name, version, directory] = line.split("\t");
    if (!directory || !version) continue;
    const files = (await readdir(directory)).filter((n) =>
      /^(LICENSE|LICENCE|NOTICE|COPYING|COPYRIGHT)([._-]|$)/i.test(n),
    );
    const texts: string[] = [];
    for (const file of files) {
      const text = await readFile(join(directory, file), "utf8").catch(
        () => undefined,
      );
      if (text) texts.push(`${file}\n${text}`);
    }
    if (!texts.length)
      throw Error(`License inventory missing for ${name}@${version}`);
    notices.push(`${name}@${version}\n\n${texts.join("\n\n")}`);
  }
  await writeFile(
    join(directory, "THIRD_PARTY_NOTICES.txt"),
    notices.sort().join("\n\n" + "=".repeat(72) + "\n\n"),
  );
  await writeFile(
    join(directory, "runtime.json"),
    JSON.stringify({
      engine: "frp",
      version: "0.71.0",
      platform: target.platform,
      arch: target.arch,
      sha256: createHash("sha256")
        .update(await readFile(output))
        .digest("hex"),
    }),
  );
  console.log(`Built ${target.platform}/${target.arch}: ${output}`);
}
if (server) {
  const directory = join(root, ".local/game-link");
  await mkdir(directory, { recursive: true });
  const child = Bun.spawn(
    [
      go,
      "build",
      "-tags",
      "noweb",
      "-mod=mod",
      "-o",
      join(directory, "frps" + (process.platform === "win32" ? ".exe" : "")),
      "github.com/fatedier/frp/cmd/frps",
    ],
    {
      cwd: join(root, "native/game-link"),
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  if (await child.exited) throw Error("Test relay build failed");
}
