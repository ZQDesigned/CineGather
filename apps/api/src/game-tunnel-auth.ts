import {
  createHmac,
  createPrivateKey,
  createPublicKey,
  createHash,
  sign,
  verify,
  timingSafeEqual,
} from "node:crypto";
import { readFileSync } from "node:fs";
import { and, eq, gt } from "drizzle-orm";
import { z } from "zod";
import {
  gameMembers,
  gameSessions,
  type Transaction,
} from "@cinegather/database";
import {
  GAME_LEASE_MS,
  gameTunnelConfigSchema,
  type GameTunnelConfig,
  type User,
} from "@cinegather/contracts";
import { hash } from "./context";
import { fail } from "./errors";
import {
  activeGameCredential,
  gameTransaction,
  requireGameDesktop,
  requireGameMember,
} from "./game-link-access";
const memberId = z.uuid();
const claimsSchema = z.strictObject({
  iss: z.string(),
  aud: z.string(),
  sub: memberId,
  sid: memberId,
  cid: memberId,
  revision: z.number().int().positive(),
  role: z.enum(["host", "guest"]),
  iat: z.number().int(),
  exp: z.number().int(),
});
export function equalSecret(a: string, b: string) {
  const left = Buffer.from(a),
    right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
export class GameTunnelAuthority {
  readonly key;
  readonly publicKey;
  readonly kid: string;
  constructor(
    readonly settings: {
      issuer: string;
      host: string;
      port: number;
      tlsName: string;
      stunServer: string;
      pluginSecret: string;
      keyFile: string;
      audience: string;
    },
  ) {
    const issuer = new URL(settings.issuer);
    if (
      (issuer.protocol !== "https:" &&
        !(issuer.protocol === "http:" && issuer.hostname === "127.0.0.1")) ||
      issuer.username ||
      issuer.password ||
      issuer.search ||
      issuer.hash ||
      !settings.issuer.endsWith("/api/v1/game-tunnel/identity") ||
      !Number.isInteger(settings.port) ||
      settings.port < 1 ||
      settings.port > 65535 ||
      settings.pluginSecret.length < 32
    )
      throw new Error("Invalid game transport settings");
    this.key = createPrivateKey(readFileSync(settings.keyFile));
    if (
      this.key.asymmetricKeyType !== "rsa" ||
      (this.key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048
    )
      throw new Error(
        "Game transport requires an RSA key of at least 2048 bits",
      );
    this.publicKey = createPublicKey(this.key);
    this.kid = createHash("sha256")
      .update(this.publicKey.export({ format: "der", type: "spki" }))
      .digest("base64url")
      .slice(0, 32);
  }
  secret(...parts: (string | number)[]) {
    return createHmac(
      "sha256",
      this.key.export({ format: "der", type: "pkcs8" }),
    )
      .update(JSON.stringify(parts))
      .digest("base64url");
  }
  jwks() {
    return {
      keys: [
        {
          ...this.publicKey.export({ format: "jwk" }),
          kid: this.kid,
          alg: "RS256",
          use: "sig",
        },
      ],
    };
  }
  discovery() {
    return {
      issuer: this.settings.issuer,
      jwks_uri: this.settings.issuer + "/jwks",
      token_endpoint: this.settings.issuer + "/token",
      grant_types_supported: ["client_credentials"],
      token_endpoint_auth_methods_supported: [
        "client_secret_basic",
        "client_secret_post",
      ],
      id_token_signing_alg_values_supported: ["RS256"],
      response_types_supported: [],
      subject_types_supported: ["public"],
    };
  }
  issue(
    claims: Omit<z.infer<typeof claimsSchema>, "iss" | "aud" | "iat" | "exp">,
    expiresAt: Date,
  ) {
    const now = Math.floor(Date.now() / 1000),
      exp = Math.min(Math.floor(expiresAt.getTime() / 1000), now + 30);
    if (exp <= now) fail(401, "GAME_AUTH_EXPIRED", "联机授权已过期");
    const input = [
      Buffer.from(
        JSON.stringify({ alg: "RS256", typ: "JWT", kid: this.kid }),
      ).toString("base64url"),
      Buffer.from(
        JSON.stringify({
          ...claims,
          iss: this.settings.issuer,
          aud: this.settings.audience,
          iat: now,
          exp,
        }),
      ).toString("base64url"),
    ].join(".");
    return {
      access_token:
        input +
        "." +
        sign("RSA-SHA256", Buffer.from(input), this.key).toString("base64url"),
      token_type: "Bearer",
      expires_in: exp - now,
    };
  }
  verify(token: string) {
    if (token.length > 4096) throw new Error("Invalid game token");
    const parts = token.split(".");
    if (parts.length !== 3) throw new Error("Invalid game token");
    const header = JSON.parse(Buffer.from(parts[0]!, "base64url").toString());
    if (
      header.alg !== "RS256" ||
      header.kid !== this.kid ||
      !verify(
        "RSA-SHA256",
        Buffer.from(parts[0] + "." + parts[1]),
        this.publicKey,
        Buffer.from(parts[2]!, "base64url"),
      )
    )
      throw new Error("Invalid game token");
    const claims = claimsSchema.parse(
      JSON.parse(Buffer.from(parts[1]!, "base64url").toString()),
    );
    const now = Math.floor(Date.now() / 1000);
    if (
      claims.iss !== this.settings.issuer ||
      claims.aud !== this.settings.audience ||
      claims.exp <= now ||
      claims.iat > now + 1 ||
      claims.exp - claims.iat > 30
    )
      throw new Error("Invalid game token");
    return claims;
  }
}
let cached: { identity: string; authority: GameTunnelAuthority } | undefined;
export function gameAuthority() {
  const env = process.env;
  if (
    !env.GAME_TUNNEL_KEY_FILE ||
    !env.GAME_TUNNEL_HOST ||
    !env.GAME_TUNNEL_ISSUER ||
    !env.GAME_TUNNEL_PLUGIN_SECRET
  )
    fail(503, "GAME_SERVICE_UNAVAILABLE", "游戏联机服务暂未开放，请稍后再试");
  const settings = {
    keyFile: env.GAME_TUNNEL_KEY_FILE,
    host: env.GAME_TUNNEL_HOST,
    issuer: env.GAME_TUNNEL_ISSUER,
    pluginSecret: env.GAME_TUNNEL_PLUGIN_SECRET,
    port: Number(env.GAME_TUNNEL_PORT ?? 17443),
    tlsName: env.GAME_TUNNEL_TLS_NAME ?? env.GAME_TUNNEL_HOST,
    audience: "cinegather-game",
    stunServer: env.GAME_TUNNEL_STUN_SERVER ?? `${env.GAME_TUNNEL_HOST}:3478`,
  };
  const identity = JSON.stringify(settings);
  if (cached?.identity !== identity)
    cached = { identity, authority: new GameTunnelAuthority(settings) };
  return cached!.authority;
}
export async function liveTunnelMember(tx: Transaction, id: string) {
  const [member] = await tx
    .select()
    .from(gameMembers)
    .where(
      and(
        eq(gameMembers.id, id),
        eq(gameMembers.active, true),
        gt(gameMembers.leaseUntil, new Date()),
      ),
    );
  if (!member || !member.tunnelSecretHash) return;
  const [session] = await tx
    .select()
    .from(gameSessions)
    .where(eq(gameSessions.id, member.sessionId));
  if (!session || session.status === "ended" || session.status === "recovering")
    return;
  if (member.role === "guest" && session.status !== "open") return;
  const account = await activeGameCredential(
    tx,
    member.userId,
    member.credentialId,
  );
  if (!account || (member.role === "host" && !account.gameHostEnabled)) return;
  const [host] = await tx
    .select()
    .from(gameMembers)
    .where(
      and(
        eq(gameMembers.sessionId, session.id),
        eq(gameMembers.role, "host"),
        eq(gameMembers.active, true),
        gt(gameMembers.leaseUntil, new Date()),
      ),
    );
  if (
    !host ||
    !(await activeGameCredential(tx, host.userId, host.credentialId))
      ?.gameHostEnabled
  )
    return;
  return { member, session, host };
}
export function gameProxyName(
  peer: { publisherId: string; visitorId: string; revision: number },
  type: "stcp" | "xtcp",
) {
  return `${peer.publisherId}.cg_${peer.visitorId.replaceAll("-", "")}_r${peer.revision}_${type}`;
}
export function peerGrant(
  authority: GameTunnelAuthority,
  host: typeof gameMembers.$inferSelect,
  guest: typeof gameMembers.$inferSelect,
) {
  return {
    memberId: guest.id,
    expiresAt: new Date(
      Math.min(host.leaseUntil.getTime(), guest.leaseUntil.getTime()),
    ).toISOString(),
    revision: guest.revision,
    publisherId: host.id,
    visitorId: guest.id,
    secret: authority.secret(
      "peer",
      host.id,
      host.revision,
      guest.id,
      guest.revision,
    ),
  };
}
export async function issueGameTransport(
  user: User,
  sessionId: string,
): Promise<GameTunnelConfig> {
  requireGameDesktop(user);
  const authority = gameAuthority();
  return gameTransaction(async (tx) => {
    const { member, session } = await requireGameMember(tx, user, sessionId);
    if (
      member.leaseUntil.getTime() <= Date.now() ||
      session.status === "recovering"
    )
      fail(409, "GAME_AUTH_EXPIRED", "请先恢复联机授权");
    const clientSecret = authority.secret(
      "client",
      member.id,
      member.revision,
      member.credentialId,
    );
    await tx
      .update(gameMembers)
      .set({ tunnelSecretHash: hash(clientSecret) })
      .where(eq(gameMembers.id, member.id));
    const members = await tx
      .select()
      .from(gameMembers)
      .where(
        and(
          eq(gameMembers.sessionId, sessionId),
          eq(gameMembers.active, true),
          gt(gameMembers.leaseUntil, new Date()),
        ),
      );
    const host = members.find((m) => m.role === "host");
    if (!host) fail(409, "GAME_NOT_READY", "主机正在恢复连接");
    return gameTunnelConfigSchema.parse({
      sessionId: session.id,
      memberId: member.id,
      revision: member.revision,
      role: member.role === "host" ? "host" : "guest",
      expiresAt: new Date(
        Math.min(member.leaseUntil.getTime(), Date.now() + GAME_LEASE_MS),
      ).toISOString(),
      clientId: member.id,
      clientSecret,
      server: {
        host: authority.settings.host,
        port: authority.settings.port,
        tlsName: authority.settings.tlsName,
        stunServer: authority.settings.stunServer,
        issuer: authority.settings.issuer,
        audience: authority.settings.audience,
      },
      peers: (member.role === "host"
        ? members.filter((m) => m.role === "guest")
        : [member]
      ).map((g) => peerGrant(authority, host, g)),
    });
  });
}
export async function gameAccessToken(
  id: string,
  secret: string,
  audience: string,
) {
  const authority = gameAuthority();
  if (
    !memberId.safeParse(id).success ||
    audience !== authority.settings.audience
  )
    fail(401, "GAME_AUTH_INVALID", "联机授权无效");
  return gameTransaction(async (tx) => {
    const live = await liveTunnelMember(tx, id);
    if (!live || !equalSecret(hash(secret), live.member.tunnelSecretHash!))
      fail(401, "GAME_AUTH_INVALID", "联机授权已失效");
    const { member, host } = live;
    return authority.issue(
      {
        sub: member.id,
        sid: member.sessionId,
        cid: member.credentialId,
        revision: member.revision,
        role: member.role === "host" ? "host" : "guest",
      },
      new Date(
        Math.min(member.leaseUntil.getTime(), host.leaseUntil.getTime()),
      ),
    );
  });
}
const hookSchema = z.object({
  version: z.literal("0.1.0"),
  op: z.enum([
    "Login",
    "NewProxy",
    "Ping",
    "NewWorkConn",
    "NewUserConn",
    "CloseProxy",
  ]),
  content: z.record(z.string(), z.unknown()),
});
const userInfo = z.object({ user: memberId });
export async function validateGameTunnelHook(body: unknown) {
  try {
    const hook = hookSchema.parse(body),
      authority = gameAuthority(),
      c = hook.content;
    return await gameTransaction(async (tx) => {
      const id =
        hook.op === "Login"
          ? memberId.parse(c.user)
          : userInfo.parse(c.user).user;
      const live = await liveTunnelMember(tx, id);
      if (!live) throw new Error("Expired member");
      const { member, host } = live;
      if (hook.op === "Login") {
        const claims = authority.verify(z.string().parse(c.privilege_key));
        if (
          claims.sub !== member.id ||
          claims.sid !== member.sessionId ||
          claims.cid !== member.credentialId ||
          claims.revision !== member.revision ||
          claims.role !== member.role
        )
          throw new Error("Identity mismatch");
      }
      if (
        hook.op === "NewProxy" ||
        hook.op === "NewUserConn" ||
        hook.op === "CloseProxy"
      ) {
        if (member.role !== "host") throw new Error("Publisher required");
        const peers = await tx
          .select()
          .from(gameMembers)
          .where(
            and(
              eq(gameMembers.sessionId, member.sessionId),
              eq(gameMembers.role, "guest"),
              eq(gameMembers.active, true),
              gt(gameMembers.leaseUntil, new Date()),
            ),
          );
        let permitted = false;
        for (const guest of peers) {
          if (
            !(await activeGameCredential(tx, guest.userId, guest.credentialId))
          )
            continue;
          const peer = peerGrant(authority, host, guest);
          for (const type of ["stcp", "xtcp"] as const) {
            if (c.proxy_name !== gameProxyName(peer, type)) continue;
            if (hook.op === "NewProxy") {
              const options = z.strictObject({
                user: z.object({
                  user: memberId,
                  run_id: z.string().optional(),
                  metas: z.record(z.string(), z.string()).nullable().optional(),
                }),
                proxy_name: z.string(),
                proxy_type: z.literal(type),
                sk: z.literal(peer.secret),
                allow_users: z.tuple([z.literal(guest.id)]),
                use_encryption: z.literal(true),
                use_compression: z.literal(false).optional(),
                bandwidth_limit: z.literal("").optional(),
                bandwidth_limit_mode: z.literal("").optional(),
                remote_port: z.literal(0).optional(),
              });
              options.parse(c);
            } else if (hook.op === "NewUserConn" && c.proxy_type !== type)
              continue;
            permitted = true;
          }
        }
        if (!permitted) throw new Error("Proxy denied");
      }
      return { reject: false, unchange: true };
    });
  } catch (error) {
    if (process.env.CG_GAME_AUTH_DEBUG === "1")
      console.error(
        JSON.stringify({
          event: "game.hook_validation",
          issues:
            error instanceof z.ZodError
              ? error.issues.map((i) => ({
                  code: i.code,
                  path: i.path,
                  keys: i.code === "unrecognized_keys" ? i.keys : undefined,
                }))
              : undefined,
        }),
      );
    return {
      reject: true,
      reject_reason: "Game authorization denied",
      unchange: true,
    };
  }
}
