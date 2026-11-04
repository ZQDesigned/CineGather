import { resolve, join } from "node:path";
import { mkdir } from "node:fs/promises";
const root = resolve(import.meta.dir, ".."),
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
  if (!["darwin", "windows"].includes(target.os))
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
      join(directory, "frps"),
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
