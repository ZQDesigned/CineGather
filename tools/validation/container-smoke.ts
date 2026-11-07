import { writeFile, mkdir, unlink } from "node:fs/promises";
const name = `cinegather-api-smoke-${process.pid}`;
const envPath = `.local/container-${process.pid}.env`;
await mkdir(".local", { recursive: true });
const values: Record<string, string> = {
  DATABASE_URL: process.env.DATABASE_URL!.replace(
    "@127.0.0.1:55432",
    "@postgres:5432",
  ),
  LIVEKIT_API_KEY: process.env.LIVEKIT_API_KEY!,
  LIVEKIT_API_SECRET: process.env.LIVEKIT_API_SECRET!,
  LIVEKIT_URL: process.env.LIVEKIT_URL!,
  LIVEKIT_INTERNAL_URL: "http://livekit:7880",
  SESSION_SECRET: process.env.SESSION_SECRET!,
  // This isolated authentication probe explicitly opts in; production stays closed.
  REGISTRATION_ENABLED: "true",
  API_HOST: "0.0.0.0",
  API_PORT: "14310",
};
await writeFile(
  envPath,
  Object.entries(values)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n"),
  { mode: 0o600 },
);
try {
  const dependencyCheck = Bun.spawn(
    [
      "docker",
      "run",
      "--rm",
      "--entrypoint",
      "node",
      "cinegather-api:0.1.0",
      "-e",
      `const fs = require("node:fs"), path = require("node:path");
     const forbidden = new Set(["esbuild", "sprintf-js", "drizzle-kit", "electron-builder", "electron", "react", "koffi"]);
     const present = new Set();
     function inspect(dir) {
       for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
         const filename = path.join(dir, entry.name);
         if (entry.isDirectory()) inspect(filename);
         else if (entry.isFile() && entry.name === "package.json") {
           const pkg = JSON.parse(fs.readFileSync(filename, "utf8"));
           if (forbidden.has(pkg.name)) present.add(pkg.name);
         }
       }
     }
     inspect("/app/node_modules");
     if (present.size) { console.error("Unexpected production dependencies: " + [...present].join(", ")); process.exit(1); }
     console.log("Production dependency tree excludes development and desktop tools, including nested packages.");`,
    ],
    { stdout: "inherit", stderr: "inherit" },
  );
  if ((await dependencyCheck.exited) !== 0)
    throw new Error("Production dependency boundary failed");
  const launch = Bun.spawn(
    [
      "docker",
      "run",
      "-d",
      "--rm",
      "--name",
      name,
      "--network",
      "cinegather_default",
      "--env-file",
      envPath,
      "-p",
      "127.0.0.1:14311:14310",
      "cinegather-api:0.1.0",
    ],
    { stdout: "pipe", stderr: "inherit" },
  );
  if ((await launch.exited) !== 0) throw new Error("Container failed to start");
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const response = await fetch("http://127.0.0.1:14311/api/v1/health");
      if (response.ok) {
        const data = (await response.json()) as { runtime: string };
        if (!data.runtime.startsWith("node "))
          throw new Error("Unexpected production runtime");
        ready = true;
        console.log(`Production health passed (${data.runtime}).`);
        break;
      }
    } catch {
      /* Wait only while the test-owned container boots. */
    }
    await Bun.sleep(1000);
  }
  if (!ready) {
    await Bun.$`docker logs ${name}`;
    throw new Error("Container health check failed");
  }
  const accountResponse = await fetch(
    "http://127.0.0.1:14311/api/v1/accounts/register",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: `smoke_${crypto.randomUUID().slice(0, 8)}`,
        password: "Container smoke test 123!",
        displayName: "Node container probe",
      }),
    },
  );
  const account = (await accountResponse.json()) as { sessionToken: string };
  if (accountResponse.status !== 201 || !account.sessionToken)
    throw new Error("Production account authentication failed");
  const headers = {
    Authorization: `Bearer ${account.sessionToken}`,
    "Content-Type": "application/json",
  };
  const roomResponse = await fetch("http://127.0.0.1:14311/api/v1/rooms", {
    method: "POST",
    headers,
    body: JSON.stringify({ name: "容器运行时验证", maxMembers: 2 }),
  });
  const room = (await roomResponse.json()) as { id: string };
  if (roomResponse.status !== 201 || !room.id)
    throw new Error("Production database transaction failed");
  const joined = await fetch(
    `http://127.0.0.1:14311/api/v1/rooms/${room.id}/join`,
    { method: "POST", headers, body: "{}" },
  );
  if (joined.status !== 201)
    throw new Error("Production media token issuance failed");
  await fetch(`http://127.0.0.1:14311/api/v1/rooms/${room.id}/leave`, {
    method: "POST",
    headers,
  });
  console.log(
    "Production Node authentication, database transaction and LiveKit token issuance passed.",
  );
} finally {
  await Bun.spawn(["docker", "stop", "--timeout", "5", name], {
    stdout: "ignore",
    stderr: "ignore",
  }).exited;
  await unlink(envPath);
}
