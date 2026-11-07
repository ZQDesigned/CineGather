import { resolve, join } from "node:path";
// This suite creates and removes its own fixtures. Never target a normal or production DB.
const url = new URL(process.env.DATABASE_URL ?? "postgresql://invalid/invalid");
if (
  !["127.0.0.1", "localhost"].includes(url.hostname) ||
  !["/cinegather_game_dev", "/cinegather_game_test"].includes(url.pathname)
)
  throw Error(
    "Set DATABASE_URL to a migrated, isolated local cinegather_game_dev or cinegather_game_test database",
  );
const root = resolve(import.meta.dir, "../.."),
  bun = process.execPath;
const build = Bun.spawn(
  [
    bun,
    join(root, "tools/build/game-link.ts"),
    "--server",
    ...(process.platform === "linux" ? ["--test-host"] : []),
  ],
  { cwd: root, stdout: "inherit", stderr: "inherit" },
);
if (await build.exited)
  throw Error("Unable to build the pinned game transport fixtures");
const helper = join(
    root,
    ".local/native-runtime/game-link",
    `${process.platform}-${process.arch}`,
    "cinegather-game-link" + (process.platform === "win32" ? ".exe" : ""),
  ),
  frps = join(
    root,
    ".local/game-link",
    "frps" + (process.platform === "win32" ? ".exe" : ""),
  );
const tests = Bun.spawn(
  [
    bun,
    "test",
    "tests/integration/game-link.test.ts",
    "tests/integration/game-tunnel.test.ts",
    "tests/integration/game-capabilities.test.ts",
  ],
  {
    cwd: root,
    env: { ...process.env, CG_GAME_HELPER: helper, CG_GAME_FRPS: frps },
    stdout: "inherit",
    stderr: "inherit",
  },
);
process.exitCode = await tests.exited;
