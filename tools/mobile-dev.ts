import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

const signingKey = resolve(
  process.env.CG_MOBILE_SIGNING_KEY ??
    resolve(homedir(), ".config/cinegather/mobile-updates/private-key.pem"),
);
if (!existsSync(signingKey))
  throw new Error(
    "Signed mobile development builds require the update signing key. Set CG_MOBILE_SIGNING_KEY to its local file path; never copy the key into the repository.",
  );

// Development clients also validate the Metro manifest against the embedded
// update certificate. Omitting this key prevents iOS from loading the project.
const child = Bun.spawn(
  [
    "bunx",
    "expo",
    "start",
    "--dev-client",
    "--port",
    "8088",
    "--private-key-path",
    signingKey,
    ...Bun.argv.slice(2),
  ],
  {
    cwd: resolve(import.meta.dir, "../apps/mobile"),
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  },
);
process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
process.exit(await child.exited);
