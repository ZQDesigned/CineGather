import { once as nodeOnce } from "node:events";
import { beforeAll, afterAll, expect, test } from "bun:test";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, inArray } from "drizzle-orm";
import {
  users,
  credentials,
  gameSessions,
  gameMembers,
  auditLogs,
} from "@cinegather/database";
import { protocolHeaders, gameTunnelConfigSchema } from "@cinegather/contracts";
import { createApp } from "../../apps/api/src/app";
import { db, hash } from "../../apps/api/src/context";
let app: Awaited<ReturnType<typeof createApp>>,
  origin: string,
  directory: string;
const people: string[] = [];
async function person(host = false) {
  const id = crypto.randomUUID(),
    cid = crypto.randomUUID(),
    token = crypto.randomUUID();
  people.push(id);
  await db.insert(users).values({
    id,
    username: `tunnel_${id.replaceAll("-", "").slice(0, 16)}`,
    displayName: "联机通路验证",
    passwordHash: "fixture",
    gameHostEnabled: host,
  });
  await db.insert(credentials).values({
    id: cid,
    userId: id,
    kind: "account",
    secretHash: hash(token),
    expiresAt: new Date(Date.now() + 3600000),
  });
  return { id, cid, token };
}
type Person = Awaited<ReturnType<typeof person>>;
async function call(
  path: string,
  who: Person,
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
) {
  const r = await fetch(origin + "/api/v1" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${who.token}`,
      "X-CineGather-Platform": "win32",
      "X-CineGather-Version": "0.1.33",
      ...protocolHeaders,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: r.status, data: await r.json() };
}
async function token(
  config: {
    clientId: string;
    clientSecret: string;
    server: { audience: string };
  },
  secret = config.clientSecret,
) {
  const r = await fetch(origin + "/api/v1/game-tunnel/identity/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(config.clientId + ":" + secret).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      audience: config.server.audience,
    }),
  });
  return { status: r.status, data: await r.json() };
}
async function plugin(op: string, content: unknown, auth = true) {
  const r = await fetch(origin + "/api/v1/internal/game-tunnel", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(auth
        ? {
            Authorization: `Basic ${Buffer.from("game:" + process.env.GAME_TUNNEL_PLUGIN_SECRET).toString("base64")}`,
          }
        : {}),
    },
    body: JSON.stringify({ version: "0.1.0", op, content }),
  });
  return { status: r.status, data: await r.json() };
}
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "cg-game-auth-"));
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const file = join(directory, "signing.pem");
  await writeFile(file, privateKey.export({ type: "pkcs8", format: "pem" }), {
    mode: 0o600,
  });
  process.env.GAME_TUNNEL_KEY_FILE = file;
  process.env.GAME_TUNNEL_HOST = "127.0.0.1";
  process.env.GAME_TUNNEL_PORT = "18470";
  process.env.GAME_TUNNEL_TLS_NAME = "localhost";
  process.env.GAME_TUNNEL_PLUGIN_SECRET = randomBytes(32).toString("hex");
  app = await createApp();
  await app.listen(0, "127.0.0.1");
  origin = await app.getUrl();
  process.env.GAME_TUNNEL_ISSUER = origin + "/api/v1/game-tunnel/identity";
});
afterAll(async () => {
  await app.close();
  if (people.length) {
    await db
      .delete(gameSessions)
      .where(inArray(gameSessions.hostUserId, people));
    await db.delete(auditLogs).where(inArray(auditLogs.actorId, people));
    await db.delete(users).where(inArray(users.id, people));
  }
  await rm(directory, { recursive: true, force: true });
  for (const name of [
    "KEY_FILE",
    "HOST",
    "PORT",
    "TLS_NAME",
    "PLUGIN_SECRET",
    "ISSUER",
    "STUN_SERVER",
  ])
    delete process.env["GAME_TUNNEL_" + name];
});
async function admitted() {
  const host = await person(true),
    guest = await person();
  const created = await call("/games", host, { name: "通路测试" });
  const sid = created.data.session.id;
  await call(`/games/${sid}/ready`, host, {});
  const asked = await call(`/games/${sid}/requests`, guest, {});
  await call(`/games/requests/${asked.data.id}/decision`, host, {
    approve: true,
  });
  return { host, guest, sid };
}
test("transport credentials are private, scoped to approved members, and OIDC discovery exposes only the public key", async () => {
  const { host, guest, sid } = await admitted(),
    outsider = await person();
  expect((await call(`/games/${sid}/transport`, outsider)).status).toBe(403);
  const issued = await call(`/games/${sid}/transport`, guest);
  expect(issued.status).toBe(200);
  const cfg = gameTunnelConfigSchema.parse(issued.data);
  expect(cfg.peers).toHaveLength(1);
  expect(cfg.role).toBe("guest");
  expect(JSON.stringify((await call("/games", host)).data)).not.toContain(
    cfg.clientSecret,
  );
  const discovery = await fetch(
    process.env.GAME_TUNNEL_ISSUER + "/.well-known/openid-configuration",
  );
  expect(discovery.status).toBe(200);
  const jwks = await (
    await fetch(process.env.GAME_TUNNEL_ISSUER + "/jwks")
  ).json();
  expect(jwks.keys[0].kty).toBe("RSA");
  expect(jwks.keys[0].d).toBeUndefined();
  expect((await token(cfg, "wrong-secret")).status).toBe(401);
  const issuedToken = await token(cfg);
  expect(issuedToken.status).toBe(200);
  expect(issuedToken.data.expires_in).toBeLessThanOrEqual(30);
  expect(
    (
      await plugin("Login", {
        user: cfg.memberId,
        privilege_key: issuedToken.data.access_token,
      })
    ).data.reject,
  ).toBe(false);
  expect(
    (
      await plugin("Login", {
        user: crypto.randomUUID(),
        privilege_key: issuedToken.data.access_token,
      })
    ).data.reject,
  ).toBe(true);
  expect(
    (
      await plugin("Login", {
        user: cfg.memberId,
        privilege_key: issuedToken.data.access_token + "x",
      })
    ).data.reject,
  ).toBe(true);
  expect((await plugin("Login", {}, false)).status).toBe(403);
});
test("relay admission binds proxy names, role, peer secret, allowed visitor and current lease", async () => {
  const { host, guest, sid } = await admitted();
  const owner = (await call(`/games/${sid}/transport`, host)).data,
    visitor = (await call(`/games/${sid}/transport`, guest)).data;
  const { gameProxyName } = await import("../../apps/api/src/game-tunnel-auth");
  const peer = owner.peers[0];
  const good = {
    user: { user: owner.memberId, metas: null },
    proxy_name: gameProxyName(peer, "stcp"),
    proxy_type: "stcp",
    sk: peer.secret,
    allow_users: [visitor.memberId],
    use_encryption: true,
  };
  expect((await plugin("NewProxy", good)).data.reject).toBe(false);
  for (const forged of [
    { ...good, proxy_type: "tcp" },
    { ...good, sk: "wrong" },
    { ...good, allow_users: ["*"] },
    { ...good, remote_port: 25565 },
    { ...good, user: { user: visitor.memberId } },
  ])
    expect((await plugin("NewProxy", forged)).data.reject).toBe(true);
  await call(
    `/games/${sid}/members/${visitor.memberId}`,
    host,
    undefined,
    "DELETE",
  );
  expect((await token(visitor)).status).toBe(401);
  expect((await plugin("NewProxy", good)).data.reject).toBe(true);
  expect(
    (await plugin("Ping", { user: { user: visitor.memberId } })).data.reject,
  ).toBe(true);
  await db
    .update(gameMembers)
    .set({ leaseUntil: new Date(Date.now() - 1) })
    .where(eq(gameMembers.id, owner.memberId));
  expect((await token(owner)).status).toBe(401);
});

for (const mode of ["relay", "p2p"] as const)
  test.skipIf(!process.env.CG_GAME_HELPER || !process.env.CG_GAME_FRPS)(
    `pinned native FRP carries real TCP bytes through ${mode} with TLS, OIDC and active revocation`,
    async () => {
      const { spawn } = await import("node:child_process"),
        { createServer, createConnection } = await import("node:net"),
        { once } = { once: nodeOnce };
      const { GameNative } = await import(
          "../../apps/desktop/src/main/game-native"
        ),
        { GameProxy } = await import("../../apps/desktop/src/main/game-proxy");
      const port = async () => {
        const s = createServer();
        s.listen(0, "127.0.0.1");
        await once(s, "listening");
        const p = (s.address() as { port: number }).port;
        await new Promise<void>((r) => s.close(() => r()));
        return p;
      };
      const relayPort = await port(),
        visitorPort = await port();
      process.env.GAME_TUNNEL_PORT = String(relayPort);
      const { createSocket } = await import("node:dgram");
      const stun = createSocket("udp4");
      stun.bind(0, "127.0.0.1");
      await once(stun, "listening");
      const stunPort = stun.address().port;
      process.env.GAME_TUNNEL_STUN_SERVER = `127.0.0.1:${stunPort}`;
      stun.on("message", (request, remote) => {
        if (
          mode !== "p2p" ||
          request.length < 20 ||
          request.readUInt16BE(0) !== 1
        )
          return;
        const response = Buffer.alloc(44);
        request.copy(response, 0, 0, 20);
        response.writeUInt16BE(0x0101, 0);
        response.writeUInt16BE(24, 2);
        response.writeUInt16BE(0x0020, 20);
        response.writeUInt16BE(8, 22);
        response[25] = 1;
        response.writeUInt16BE(remote.port ^ 0x2112, 26);
        remote.address.split(".").forEach((v, i) => {
          response[28 + i] = Number(v) ^ request[4 + i]!;
        });
        response.writeUInt16BE(0x802c, 32);
        response.writeUInt16BE(8, 34);
        response[37] = 1;
        response.writeUInt16BE(stunPort, 38);
        response.set([127, 0, 0, 1], 40);
        stun.send(response, remote.port, remote.address);
      });
      const cert = join(directory, "relay.crt"),
        key = join(directory, "relay.key"),
        conf = join(directory, "frps.toml");
      const openssl = Bun.spawnSync(
        [
          "openssl",
          "req",
          "-x509",
          "-newkey",
          "rsa:2048",
          "-keyout",
          key,
          "-out",
          cert,
          "-days",
          "1",
          "-nodes",
          "-subj",
          "/CN=localhost",
          "-addext",
          "subjectAltName=DNS:localhost,IP:127.0.0.1",
        ],
        { stdout: "ignore", stderr: "ignore" },
      );
      expect(openssl.exitCode).toBe(0);
      await writeFile(
        conf,
        `bindAddr = "127.0.0.1"\nbindPort = ${relayPort}\nlog.to = ${JSON.stringify(join(directory, "frps.log"))}\nlog.level = "warn"\nauth.method = "oidc"\nauth.additionalScopes = ["HeartBeats", "NewWorkConns"]\nauth.oidc.issuer = ${JSON.stringify(process.env.GAME_TUNNEL_ISSUER)}\nauth.oidc.audience = "cinegather-game"\ntransport.tcpMux = false\ntransport.tls.force = true\ntransport.tls.certFile = ${JSON.stringify(cert)}\ntransport.tls.keyFile = ${JSON.stringify(key)}\n[[httpPlugins]]\nname = "game"\naddr = ${JSON.stringify(origin.replace("http://", `http://game:${process.env.GAME_TUNNEL_PLUGIN_SECRET}@`))}\npath = "/api/v1/internal/game-tunnel"\nops = ["Login","NewProxy","Ping","NewWorkConn","NewUserConn"]\n`,
      );
      const frps = spawn(process.env.CG_GAME_FRPS!, ["-c", conf], {
        stdio: "ignore",
      });
      const sockets = new Set<import("node:net").Socket>(),
        echo = createServer((s) => {
          sockets.add(s);
          s.on("close", () => sockets.delete(s));
          s.on("error", () => {});
          s.pipe(s);
        });
      echo.listen(0, "127.0.0.1");
      await once(echo, "listening");
      const events: unknown[] = [];
      const routes: string[] = [],
        proxy = new GameProxy({
          event: (e) => {
            if (e.type === "connected" && e.route) routes.push(e.route);
          },
        }),
        owner = new GameNative({
          binaryPath: process.env.CG_GAME_HELPER!,
          development: true,
          caFile: cert,
          event: (e) => events.push(e),
        }),
        visitor = new GameNative({
          binaryPath: process.env.CG_GAME_HELPER!,
          development: true,
          caFile: cert,
          event: (e) => events.push(e),
        });
      try {
        await Bun.sleep(250);
        const { host, guest, sid } = await admitted();
        const hostCfg = gameTunnelConfigSchema.parse(
            (await call(`/games/${sid}/transport`, host)).data,
          ),
          guestCfg = gameTunnelConfigSchema.parse(
            (await call(`/games/${sid}/transport`, guest)).data,
          ),
          peer = hostCfg.peers[0]!;
        const target = {
            host: "127.0.0.1" as const,
            port: (echo.address() as { port: number }).port,
          },
          grant = { id: peer.memberId, revision: peer.revision, ttlMs: 25000 };
        const a = await proxy.createHostGateway({
            grant,
            target,
            route: "p2p",
          }),
          b = await proxy.createHostGateway({ grant, target, route: "relay" });
        await owner.configure(hostCfg, [
          {
            memberId: peer.memberId,
            p2pPort: Number(a.address.split(":")[1]),
            relayPort: Number(b.address.split(":")[1]),
          },
        ]);
        await visitor.configure(guestCfg, [], visitorPort);
        let connected: import("node:net").Socket | undefined,
          received: Buffer | undefined;
        for (let attempt = 0; attempt < 8 && !received; attempt++) {
          await Bun.sleep(300);
          const s = createConnection({ host: "127.0.0.1", port: visitorPort });
          s.on("error", () => {});
          const bytes = Buffer.from([0, 255, 31, 0, 128, 13, 10]);
          received = await new Promise<Buffer | undefined>((resolve) => {
            const timer = setTimeout(() => {
              s.destroy();
              resolve(undefined);
            }, 2500);
            s.on("connect", () => s.write(bytes));
            s.once("data", (d) => {
              clearTimeout(timer);
              connected = s;
              resolve(d);
            });
            s.once("error", () => {
              clearTimeout(timer);
              resolve(undefined);
            });
          });
          if (!received) s.destroy();
        }
        if (!received) {
          console.error(JSON.stringify({ nativeEvents: events }));
          const { readFile } = await import("node:fs/promises");
          const logs = await readFile(
            join(directory, "frps.log"),
            "utf8",
          ).catch(() => "");
          console.error(
            logs
              .replace(/eyJ[A-Za-z0-9_.-]+/g, "[token]")
              .replace(/game:[^@]+@/g, "[credentials]@"),
          );
        }
        expect(received).toEqual(Buffer.from([0, 255, 31, 0, 128, 13, 10]));
        if (mode === "p2p" && !routes.includes("p2p")) {
          for (
            let attempt = 0;
            attempt < 10 && !routes.includes("p2p");
            attempt++
          ) {
            await Bun.sleep(700);
            const next = createConnection({
              host: "127.0.0.1",
              port: visitorPort,
            });
            next.on("error", () => {});
            await new Promise<void>((resolve) => {
              const timer = setTimeout(() => {
                next.destroy();
                resolve();
              }, 2000);
              next.once("connect", () => next.write("probe"));
              next.once("data", () => {
                clearTimeout(timer);
                next.destroy();
                resolve();
              });
              next.once("error", () => {
                clearTimeout(timer);
                resolve();
              });
            });
          }
        }
        expect(routes).toContain(mode);
        const ended = once(connected!, "close");
        await proxy.revoke(peer.memberId);
        await Promise.race([
          ended,
          Bun.sleep(2000).then(() => {
            throw Error("Revoked transport remained open");
          }),
        ]);
        expect(JSON.stringify((await call("/games", host)).data)).not.toContain(
          guestCfg.clientSecret,
        );
      } finally {
        await Promise.all([owner.close(), visitor.close(), proxy.close()]);
        stun.close();
        frps.kill();
        await Promise.race([once(frps, "exit"), Bun.sleep(1000)]);
        for (const s of sockets) s.destroy();
        await new Promise<void>((r) => echo.close(() => r()));
      }
    },
    30000,
  );

test("game tokens reject a changed issuer, audience, signature algorithm and expired authorization", async () => {
  const { GameTunnelAuthority, gameAuthority } = await import(
      "../../apps/api/src/game-tunnel-auth"
    ),
    { sign } = await import("node:crypto");
  const authority = gameAuthority(),
    { host, sid } = await admitted(),
    cfg = gameTunnelConfigSchema.parse(
      (await call(`/games/${sid}/transport`, host)).data,
    );
  const issued = await token(cfg),
    jwt = issued.data.access_token as string;
  expect(authority.verify(jwt).sub).toBe(cfg.memberId);
  expect(() =>
    new GameTunnelAuthority({
      ...authority.settings,
      issuer: origin + "/other/api/v1/game-tunnel/identity",
    }).verify(jwt),
  ).toThrow();
  expect(() =>
    new GameTunnelAuthority({
      ...authority.settings,
      audience: "other-game",
    }).verify(jwt),
  ).toThrow();
  const [header, payload] = jwt.split(".");
  const data = JSON.parse(Buffer.from(payload!, "base64url").toString());
  data.exp = Math.floor(Date.now() / 1000) - 1;
  const input =
      header + "." + Buffer.from(JSON.stringify(data)).toString("base64url"),
    expired =
      input +
      "." +
      sign("RSA-SHA256", Buffer.from(input), authority.key).toString(
        "base64url",
      );
  expect(() => authority.verify(expired)).toThrow();
  expect(() =>
    authority.verify(
      Buffer.from(JSON.stringify({ alg: "none", kid: authority.kid })).toString(
        "base64url",
      ) +
        "." +
        payload +
        ".",
    ),
  ).toThrow();
  await db
    .update(users)
    .set({ gameHostEnabled: false })
    .where(eq(users.id, host.id));
  expect((await token(cfg)).status).toBe(401);
});

test("public game identity throttling uses trusted forwarded client IPs instead of combining all Nginx visitors", async () => {
  const proxyApp = await createApp({ trustedProxies: ["loopback"] });
  await proxyApp.listen(0, "127.0.0.1");
  const proxyOrigin = await proxyApp.getUrl();
  try {
    const statuses: number[] = [];
    for (let batch = 0; batch < 62; batch++)
      statuses.push(
        ...(await Promise.all(
          Array.from({ length: 10 }, () =>
            fetch(
              proxyOrigin +
                "/api/v1/game-tunnel/identity/.well-known/openid-configuration",
              {
                headers: {
                  "X-Forwarded-For": batch < 31 ? "192.0.2.101" : "192.0.2.102",
                },
              },
            ).then(async (r) => {
              await r.arrayBuffer();
              return r.status;
            }),
          ),
        )),
      );
    expect(statuses.every((status) => status === 200)).toBe(true);
  } finally {
    await proxyApp.close();
  }
}, 15000);
