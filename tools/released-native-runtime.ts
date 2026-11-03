// An optional build cache must meet the same signature and digest checks as an update.
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { clientUpdateOrigin } from "@cinegather/contracts";
import { verifyRelease } from "../apps/desktop/src/main/update-release";
const key = await readFile(
  "apps/desktop/resources/update-public-key.pem",
  "utf8",
);
const metadata = await fetch(
  clientUpdateOrigin + "/updates/stable/win32-x64.json",
  { signal: AbortSignal.timeout(20000), cache: "no-store" },
);
if (!metadata.ok) throw Error("Released native runtime metadata unavailable");
const release = verifyRelease(await metadata.text(), key, "win32", "x64");
const destination = ".local/windows-upgrade/released-setup.exe";
const matches = (bytes: Buffer) =>
  bytes.length === release.artifact.size &&
  createHash("sha512").update(bytes).digest("base64") ===
    release.artifact.sha512;
let bytes: Buffer | undefined;
if (process.argv.includes("--cached")) {
  try {
    const cached = await readFile(destination);
    if (matches(cached)) bytes = cached;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
  }
}
if (!bytes) {
  const response = await fetch(
    clientUpdateOrigin + "/downloads/" + release.artifact.file,
    { signal: AbortSignal.timeout(180000) },
  );
  if (!response.ok)
    throw Error("Released native runtime installer unavailable");
  bytes = Buffer.from(await response.arrayBuffer());
}
if (
  bytes.length !== release.artifact.size ||
  createHash("sha512").update(bytes).digest("base64") !==
    release.artifact.sha512
)
  throw Error("Released native runtime installer digest mismatch");
await mkdir(".local/windows-upgrade", { recursive: true });
await writeFile(destination, bytes);
console.log("Verified released native runtime installer", release.version);
