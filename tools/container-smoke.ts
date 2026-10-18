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
  const guestResponse = await fetch("http://127.0.0.1:14311/api/v1/guests", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ displayName: "Node container probe" }),
  });
  const guest = (await guestResponse.json()) as { sessionToken: string };
  if (guestResponse.status !== 201 || !guest.sessionToken)
    throw new Error("Production guest authentication failed");
  const headers = {
    Authorization: `Bearer ${guest.sessionToken}`,
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
