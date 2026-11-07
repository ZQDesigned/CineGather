import { expect, test } from "bun:test";
import { createServer, createConnection } from "node:net";
import { once } from "node:events";
import { mkdtemp, writeFile, readFile, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GameTunnelConfig } from "@cinegather/contracts";
import { GameLocal } from "../src/main/games/game-local";
import { encodeGameVarInt } from "../src/main/games/minecraft-worlds";
function config(): GameTunnelConfig {
  const memberId = crypto.randomUUID(),
    guest = crypto.randomUUID(),
    expiresAt = new Date(Date.now() + 25000).toISOString();
  return {
    sessionId: crypto.randomUUID(),
    memberId,
    clientId: memberId,
    clientSecret: "a".repeat(43),
    revision: 1,
    role: "host",
    expiresAt,
    server: {
      host: "games.example.test",
      port: 17443,
      tlsName: "games.example.test",
      issuer: "https://api.example.test/api/v1/game-tunnel/identity",
      stunServer: "games.example.test:3478",
      audience: "cinegather-game",
    },
    peers: [
      {
        memberId: guest,
        publisherId: memberId,
        visitorId: guest,
        revision: 1,
        secret: "b".repeat(43),
        expiresAt,
      },
    ],
  };
}
test("host reconciliation removes a peer's actual loopback sockets and exposes no backend configuration in public status", async () => {
  const root = await mkdtemp(join(tmpdir(), "cg-game-local-")),
    binary = join(root, "native-fixture"),
    bindings = join(root, "bindings.json");
  const sockets = new Set<import("node:net").Socket>();
  const server = createServer((s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
    s.on("error", () => {});
    s.once("data", () => {
      const json = Buffer.from(
          JSON.stringify({
            version: { name: "1.21", protocol: 1 },
            description: "fixture",
          }),
        ),
        body = Buffer.concat([
          Buffer.from([0]),
          encodeGameVarInt(json.length),
          json,
        ]);
      s.write(Buffer.concat([encodeGameVarInt(body.length), body]));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  await writeFile(
    binary,
    `#!/usr/bin/env node
let b='';process.stdin.on('data',data=>{b+=data;for(;;){const n=b.indexOf('\\n');if(n<0)break;const c=JSON.parse(b.slice(0,n));b=b.slice(n+1);if(c.config)require('node:fs').writeFileSync(${JSON.stringify(bindings)},JSON.stringify(c.config.bindings));process.stdout.write(JSON.stringify({id:c.id,ok:true,result:{state:'configured'}})+'\\n');if(c.op==='stop')process.exit(0)}});`,
  );
  await chmod(binary, 0o700);
  const local = new GameLocal({ binaryPath: binary }),
    transport = config();
  try {
    const status = await local.configure(
      transport,
      (server.address() as { port: number }).port,
    );
    expect(status.state).toBe("connected");
    expect(JSON.stringify(status)).not.toMatch(
      /secret|example.test|publisherId/,
    );
    const ports = JSON.parse(await readFile(bindings, "utf8"));
    const socket = createConnection({
      host: "127.0.0.1",
      port: ports[0].p2pPort,
    });
    socket.on("error", () => {});
    await once(socket, "connect");
    const closed = new Promise<void>((r) => socket.once("close", () => r()));
    await local.configure({ ...transport, peers: [] });
    await closed;
    expect(local.status.state).toBe("connected");
  } finally {
    await local.stop();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((r) => server.close(() => r()));
    await rm(root, { recursive: true, force: true });
  }
});
test("stopping during local world verification cancels stale work before a native process can start", async () => {
  const sockets = new Set<import("node:net").Socket>(),
    server = createServer((s) => {
      sockets.add(s);
      s.on("close", () => sockets.delete(s));
    });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const local = new GameLocal({ binaryPath: "/nonexistent-game-fixture" });
  const connected = once(server, "connection");
  const task = local.configure(
    config(),
    (server.address() as { port: number }).port,
  );
  const rejected = task.then(
    () => false,
    () => true,
  );
  await connected;
  await local.stop();
  expect(await rejected).toBe(true);
  expect(local.status.state).toBe("idle");
  for (const s of sockets) s.destroy();
  await new Promise<void>((r) => server.close(() => r()));
});

test("host health tolerates one missed MC probe, detects world closure and releases the native transport", async () => {
  const root = await mkdtemp(join(tmpdir(), "cg-world-health-")),
    binary = join(root, "fixture");
  await writeFile(
    binary,
    `#!/usr/bin/env node
let b='';process.stdin.on('data',data=>{b+=data;for(;;){const n=b.indexOf('\\n');if(n<0)break;const c=JSON.parse(b.slice(0,n));b=b.slice(n+1);process.stdout.write(JSON.stringify({id:c.id,ok:true,result:{state:'configured'}})+'\\n');if(c.op==='stop')process.exit(0)}});`,
  );
  await chmod(binary, 0o700);
  let healthy = true;
  const sockets = new Set<import("node:net").Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
    socket.once("data", () => {
      if (!healthy) {
        socket.destroy();
        return;
      }
      const json = Buffer.from(
        JSON.stringify({
          version: { name: "1.21", protocol: 1 },
          description: "world",
        }),
      );
      const body = Buffer.concat([
        Buffer.from([0]),
        encodeGameVarInt(json.length),
        json,
      ]);
      socket.write(Buffer.concat([encodeGameVarInt(body.length), body]));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const transport = { ...config(), peers: [] },
    events: unknown[] = [],
    local = new GameLocal({ binaryPath: binary, event: (e) => events.push(e) });
  const port = (server.address() as { port: number }).port;
  try {
    await local.configure(transport, port);
    healthy = false;
    expect((await local.configure(transport, port)).state).toBe("connected");
    healthy = true;
    expect((await local.configure(transport, port)).state).toBe("connected");
    // A real closed listening socket must be detected on subsequent renewal.
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((r) => server.close(() => r()));
    expect((await local.configure(transport, port)).state).toBe("connected");
    await expect(local.configure(transport, port)).rejects.toThrow(
      "局域网共享已停止",
    );
    expect(local.status).toMatchObject({
      state: "failed",
      reason: "world-unavailable",
    });
    expect(events).toContainEqual(
      expect.objectContaining({ event: "process", state: "exited" }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "port-probe",
        code: "WORLD_UNAVAILABLE",
      }),
    );
  } finally {
    await local.stop();
    for (const socket of sockets) socket.destroy();
    if (server.listening)
      await new Promise<void>((r) => server.close(() => r()));
    await rm(root, { recursive: true, force: true });
  }
});
