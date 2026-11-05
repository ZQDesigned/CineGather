import { z } from "zod";
import { adminQuery } from "./admin";
import { gameKindSchema } from "./game-link";
export const adminGameQuery = adminQuery.extend({
  status: z.enum(["all", "active", "ended"]).default("all"),
});
export const adminGameSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  code: z.string(),
  game: gameKindSchema,
  gameVersion: z.string().nullable(),
  hostUserId: z.uuid(),
  hostName: z.string(),
  hostUsername: z.string(),
  status: z.enum(["starting", "open", "recovering", "ended"]),
  memberCount: z.number(),
  maxMembers: z.number(),
  createdAt: z.string(),
  endedAt: z.string().nullable(),
});
export const adminGamesSchema = z.object({
  items: z.array(adminGameSchema),
  total: z.number(),
});
export const adminGameMemberSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  displayName: z.string(),
  username: z.string(),
  role: z.enum(["host", "guest"]),
  status: z.string(),
  active: z.boolean(),
  route: z.enum(["p2p", "relay"]).nullable(),
  createdAt: z.string(),
});
export const adminGameMembersSchema = z.object({
  items: z.array(adminGameMemberSchema),
  total: z.number(),
});
export const adminSessionEventSchema = z.object({
  id: z.uuid(),
  actorName: z.string(),
  action: z.string(),
  sessionName: z.string(),
  sessionCode: z.string(),
  memberName: z.string(),
  reason: z.string(),
  createdAt: z.string(),
});
export const adminSessionEventsSchema = z.object({
  items: z.array(adminSessionEventSchema),
  total: z.number(),
});
export type AdminGame = z.infer<typeof adminGameSchema>;
export type AdminGameMember = z.infer<typeof adminGameMemberSchema>;
export type AdminSessionEvent = z.infer<typeof adminSessionEventSchema>;
export type AdminGameQuery = z.infer<typeof adminGameQuery>;
