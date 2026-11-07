import { expect, test } from "bun:test";
import { createSocket } from "node:dgram";
import { once } from "node:events";
import { mkdtemp, writeFile, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GameTunnelConfig } from "@cinegather/contracts";
import { GameLocal } from "../src/main/games/game-local";

test("port probing records readiness and missing-service reasons without starting the native transport", async () => {
  const events: unknown[] = [],
    local = new GameLocal({
      binaryPath: "must-not-start",
      event: (event) => events.push(event),
    }),
    socket = createSocket("udp4");
  socket.bind(0, "127.0.0.1");
  await once(socket, "listening");
  const port = socket.address().port;
  try {
    await local.probe(port, "stardew-valley");
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "port-probe",
        game: "stardew-valley",
        code: "PORT_READY",
      }),
    );
  } finally {
    const closed = once(socket, "close");
    socket.close();
    await closed;
  }
  await expect(local.probe(port, "stardew-valley")).rejects.toThrow("合作农场");
  expect(events).toContainEqual(
    expect.objectContaining({
      type: "port-probe",
      game: "stardew-valley",
      code: "PORT_NOT_LISTENING",
    }),
  );
  await local.stop();
});

test("Stardew local host and guest configure the complete production gateway path and clean the fixed game port", async () => {
  const root = await mkdtemp(join(tmpdir(), "cg-stardew-local-")),
    binary = join(root, "transport-fixture"),
    binding = join(root, "binding.json");
  // Only the external FRP process is replaced. Every local gateway, frame,
  // datagram socket, health probe, lease and cleanup is the production code.
  await writeFile(
    binary,
    `#!/usr/bin/env node
const net=require('node:net'),fs=require('node:fs');let text='',server;
function reply(id){process.stdout.write(JSON.stringify({id,ok:true,result:{}})+'\\n');}
process.stdin.on('data',chunk=>{text+=chunk;for(;;){const end=text.indexOf('\\n');if(end<0)break;const message=JSON.parse(text.slice(0,end));text=text.slice(end+1);if(message.op==='stop')process.exit(0);const c=message.config;if(c.role==='host'){fs.writeFileSync(${JSON.stringify(binding)},JSON.stringify(c.bindings));reply(message.id);}else if(server){reply(message.id);}else{server=net.createServer(s=>{const peer=JSON.parse(fs.readFileSync(${JSON.stringify(binding)},'utf8'))[0];if(!peer){s.destroy();return;}const target=net.createConnection({host:'127.0.0.1',port:peer.relayPort});s.on('error',()=>{});target.on('error',()=>s.destroy());s.on('close',()=>target.destroy());target.on('close',()=>s.destroy());s.pipe(target);target.pipe(s);});server.listen(c.visitorPort,'127.0.0.1',()=>reply(message.id));}}});`,
  );
  await chmod(binary, 0o700);
  const memberId = crypto.randomUUID(),
    guestId = crypto.randomUUID(),
    expiresAt = new Date(Date.now() + 25000).toISOString();
  const config: GameTunnelConfig = {
    game: "stardew-valley",
    sessionId: crypto.randomUUID(),
    memberId,
    clientId: memberId,
    clientSecret: "a".repeat(43),
    revision: 1,
    role: "host",
    expiresAt,
    server: {
      host: "games.example.test",
      port: 443,
      tlsName: "games.example.test",
      issuer: "https://api.example.test/api/v1/game-tunnel/identity",
      stunServer: "games.example.test:3478",
      audience: "cinegather-game",
    },
    peers: [
      {
        memberId: guestId,
        visitorId: guestId,
        publisherId: memberId,
        revision: 1,
        secret: "b".repeat(43),
        expiresAt,
      },
    ],
  };
  const host = new GameLocal({ binaryPath: binary }),
    guest = new GameLocal({ binaryPath: binary }),
    game = createSocket("udp4"),
    client = createSocket("udp4");
  game.bind(0, "127.0.0.1");
  await once(game, "listening");
  game.on("message", (p, r) => game.send(p, r.port, r.address));
  try {
    expect((await host.configure(config, game.address().port)).state).toBe(
      "connected",
    );
    const status = await guest.configure({
      ...config,
      role: "guest",
      memberId: guestId,
      clientId: guestId,
    });
    expect(status).toMatchObject({
      state: "connected",
      address: "127.0.0.1:24642",
    });
    const reply = once(client, "message");
    client.send(Buffer.from([1, 0, 255]), 24642, "127.0.0.1");
    expect((await reply)[0]).toEqual(Buffer.from([1, 0, 255]));
    await host.configure({ ...config, peers: [] });
    await guest.stop();
    expect(guest.status.state).toBe("idle");
    const free = createSocket("udp4");
    free.bind(24642, "127.0.0.1");
    await once(free, "listening");
    free.close();
  } finally {
    await Promise.all([host.stop(), guest.stop()]);
    game.close();
    try {
      client.close();
    } catch {
      /* not bound */
    }
    await rm(root, { recursive: true, force: true });
  }
}, 10000);

test("Stardew host detects a closed farm, tolerates an indeterminate port query and releases its native process", async () => {
  const { spyOn } = await import("bun:test");
  const root = await mkdtemp(join(tmpdir(), "cg-star-health-")),
    binary = join(root, "fixture");
  await writeFile(
    binary,
    `#!/usr/bin/env node
let b='';process.stdin.on('data',d=>{b+=d;for(;;){const n=b.indexOf('\\n');if(n<0)break;const c=JSON.parse(b.slice(0,n));b=b.slice(n+1);process.stdout.write(JSON.stringify({id:c.id,ok:true,result:{state:'configured'}})+'\\n');if(c.op==='stop')process.exit(0)}});`,
  );
  await chmod(binary, 0o700);
  const socket = createSocket("udp4");
  socket.bind(0, "127.0.0.1");
  await once(socket, "listening");
  const port = socket.address().port,
    memberId = crypto.randomUUID(),
    events: unknown[] = [];
  const config: GameTunnelConfig = {
    game: "stardew-valley",
    sessionId: crypto.randomUUID(),
    memberId,
    clientId: memberId,
    clientSecret: "x".repeat(43),
    revision: 1,
    role: "host",
    expiresAt: new Date(Date.now() + 25000).toISOString(),
    peers: [],
    server: {
      host: "games.example.test",
      port: 443,
      tlsName: "games.example.test",
      issuer: "https://api.example.test/api/v1/game-tunnel/identity",
      stunServer: "games.example.test:3478",
      audience: "cinegather-game",
    },
  };
  const local = new GameLocal({
    binaryPath: binary,
    event: (e) => events.push(e),
  });
  let closed = false;
  try {
    await local.configure(config, port);
    const query = spyOn(local, "probe").mockRejectedValue(
      Object.assign(Error("query failed"), { code: "PORT_TABLE_FAILED" }),
    );
    try {
      expect((await local.configure(config, port)).state).toBe("connected");
      expect((await local.configure(config, port)).state).toBe("connected");
    } finally {
      query.mockRestore();
    }
    const done = once(socket, "close");
    socket.close();
    await done;
    closed = true;
    expect((await local.configure(config, port)).state).toBe("connected");
    await expect(local.configure(config, port)).rejects.toThrow("共享已停止");
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
        game: "stardew-valley",
        code: "WORLD_UNAVAILABLE",
      }),
    );
  } finally {
    await local.stop();
    if (!closed) socket.close();
    await rm(root, { recursive: true, force: true });
  }
});
