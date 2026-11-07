import { mkdir, mkdtemp, cp, rm, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";

const output = resolve(process.argv[2] ?? ".local/releases");
if ((await Bun.$`git status --porcelain`.text()).trim())
  throw new Error(
    "Commit the reviewed source before creating a server release",
  );
await Bun.$`bun run git:verify`;
await Bun.$`bun run --filter @cinegather/api build`;
await Bun.$`bun run build:web`;
const sha = (await Bun.$`git rev-parse HEAD`.text()).trim();
const staging = await mkdtemp(join(tmpdir(), "cinegather-source-"));
await mkdir(output, { recursive: true });
try {
  const archive = join(output, `CineGather-server-${sha.slice(0, 12)}.tar.gz`);
  const source = join(staging, "source.tar");
  await Bun.$`git archive --format=tar --output=${source} HEAD`;
  const root = join(staging, "cinegather");
  await mkdir(root);
  await Bun.$`tar -xf ${source} -C ${root}`;
  for (const path of ["apps/api/dist", "apps/web/dist"]) {
    await mkdir(join(root, path), { recursive: true });
    await cp(path, join(root, path), { recursive: true });
  }
  await writeFile(
    join(root, "server-release.json"),
    JSON.stringify(
      {
        gitSha: sha,
        builtAt: new Date().toISOString(),
        runtime: "node24",
        install:
          "bun install --frozen-lockfile --production --ignore-scripts --filter '@cinegather/api...'",
      },
      null,
      2,
    ),
  );
  await Bun.$`tar -czf ${archive} -C ${root} .`;
  const bytes = new Uint8Array(await Bun.file(archive).arrayBuffer());
  const digest = createHash("sha256").update(bytes).digest("hex");
  await writeFile(
    `${archive}.sha256`,
    `${digest}  ${archive.split("/").pop()}\n`,
  );
  console.log(`Server source release: ${archive}`);
} finally {
  await rm(staging, { recursive: true, force: true });
}
