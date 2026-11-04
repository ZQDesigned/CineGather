import { z } from "zod";

export const GAME_MAX_MEMBERS = 8;
export const GAME_LEASE_MS = 30_000;
export const GAME_RENEW_MS = 10_000;
export const GAME_RESERVATION_MS = 120_000;
export const GAME_REQUEST_MS = 300_000;
export const GAME_INVITE_MS = 600_000;
export const gameKindSchema = z.enum(["minecraft-java"]);
export type GameKind = z.infer<typeof gameKindSchema>;
export const gameTitles: Record<GameKind, string> = {
  "minecraft-java": "Minecraft Java 版",
};
export const gameCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-HJ-NP-Z2-9]{8}$/);
export const gamePortSchema = z.number().int().min(1).max(65535);
export const gameLocalAddressSchema = z
  .string()
  .regex(/^127\.0\.0\.1:[1-9][0-9]{0,4}$/)
  .refine((s) => Number(s.split(":")[1]) <= 65535);
const time = z.iso.datetime({ offset: true });
export const gameSessionInput = z.strictObject({
  game: gameKindSchema.default("minecraft-java"),
  name: z.string().trim().min(1).max(64),
  gameVersion: z.string().trim().min(1).max(64).optional(),
});
export const gameSessionSchema = z.strictObject({
  id: z.uuid(),
  code: gameCodeSchema,
  name: z.string(),
  game: gameKindSchema,
  hostUserId: z.uuid(),
  hostName: z.string(),
  status: z.enum(["starting", "open", "recovering", "ended"]),
  maxMembers: z.literal(GAME_MAX_MEMBERS),
  memberCount: z.number().int().min(1).max(GAME_MAX_MEMBERS),
  gameVersion: z.string().nullable(),
  createdAt: time,
});
export const gameMemberSchema = z.strictObject({
  id: z.uuid(),
  userId: z.uuid(),
  displayName: z.string(),
  role: z.enum(["host", "guest"]),
  status: z.enum(["approved", "connecting", "connected", "reconnecting"]),
  route: z.enum(["p2p", "relay"]).nullable(),
});
export const gameRequestSchema = z.strictObject({
  id: z.uuid(),
  sessionId: z.uuid(),
  userId: z.uuid(),
  displayName: z.string(),
  status: z.enum(["pending", "approved", "rejected", "cancelled", "expired"]),
  expiresAt: time,
});
export const gameInvitationSchema = z.strictObject({
  id: z.uuid(),
  sessionId: z.uuid(),
  sessionName: z.string(),
  hostName: z.string(),
  expiresAt: time,
});
export const gameSelfSchema = z.strictObject({
  memberId: z.uuid(),
  revision: z.number().int().positive(),
  role: z.enum(["host", "guest"]),
  leaseExpiresAt: time,
});
export const gameSnapshotSchema = z.strictObject({
  session: gameSessionSchema.nullable(),
  self: gameSelfSchema.nullable(),
  members: z.array(gameMemberSchema).max(GAME_MAX_MEMBERS),
  requests: z.array(gameRequestSchema).max(100),
  invitations: z.array(gameInvitationSchema).max(100),
});
export const gameLookupSchema = gameSessionSchema.pick({
  id: true,
  name: true,
  hostName: true,
  maxMembers: true,
  memberCount: true,
  gameVersion: true,
});
export const gameDecisionInput = z.strictObject({ approve: z.boolean() });
export const gameRenewInput = z.strictObject({
  revision: z.number().int().positive(),
});
export const gameInviteInput = z.strictObject({ userId: z.uuid() });
export const gameLookupInput = z.strictObject({ code: gameCodeSchema });
export const gameWorldSchema = z.strictObject({
  port: gamePortSchema,
  name: z.string().max(128),
  version: z.string().max(64),
  protocol: z.number().int(),
});
export const gameLocalStatusSchema = z.strictObject({
  state: z.enum([
    "idle",
    "discovering",
    "starting",
    "connecting",
    "connected",
    "reconnecting",
    "failed",
  ]),
  address: gameLocalAddressSchema.optional(),
  route: z.enum(["p2p", "relay"]).optional(),
  latencyMs: z.number().min(0).max(60000).optional(),
  message: z.string().max(500).optional(),
});
// Native-only transport credentials. Never put this object in public game snapshots
// or use it as the game address displayed to the player.
export const gameTunnelConfigSchema = z.strictObject({
  sessionId: z.uuid(),
  memberId: z.uuid(),
  revision: z.number().int().positive(),
  role: z.enum(["host", "guest"]),
  expiresAt: time,
  clientId: z.uuid(),
  clientSecret: z.string().min(32).max(128),
  server: z.strictObject({
    host: z.string().min(1).max(253),
    port: gamePortSchema,
    tlsName: z.string().min(1).max(253),
    stunServer: z.string().min(3).max(260),
    issuer: z.url(),
    audience: z.string().min(1).max(128),
  }),
  peers: z
    .array(
      z.strictObject({
        memberId: z.uuid(),
        revision: z.number().int().positive(),
        expiresAt: time,
        publisherId: z.uuid(),
        visitorId: z.uuid(),
        secret: z.string().min(32).max(128),
      }),
    )
    .max(GAME_MAX_MEMBERS - 1),
});
export type GameSession = z.infer<typeof gameSessionSchema>;
export type GameMember = z.infer<typeof gameMemberSchema>;
export type GameRequest = z.infer<typeof gameRequestSchema>;
export type GameInvitation = z.infer<typeof gameInvitationSchema>;
export type GameSnapshot = z.infer<typeof gameSnapshotSchema>;
export type GameWorld = z.infer<typeof gameWorldSchema>;
export type GameLocalStatus = z.infer<typeof gameLocalStatusSchema>;
export type GameTunnelConfig = z.infer<typeof gameTunnelConfigSchema>;
