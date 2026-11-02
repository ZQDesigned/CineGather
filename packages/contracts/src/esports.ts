import { z } from "zod";

export const ESPORTS_LIMITS = {
  teams: 2,
  playersPerTeam: 5,
  directors: 5,
  audience: 5,
  total: 20,
} as const;
export const ESPORTS_FEATURE = "esports-v1";
export const ESPORTS_RESERVATION_MS = 120_000;
export const ESPORTS_PREWARM_MS = 5_000;
export const esportsTeamSchema = z.enum(["a", "b"]);
export const esportsSeatSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("player"), team: esportsTeamSchema }),
  z.strictObject({ kind: z.literal("director") }),
  z.strictObject({ kind: z.literal("audience") }),
]);
export type EsportsSeat = z.infer<typeof esportsSeatSchema>;
export const esportsChannelSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("team"), team: esportsTeamSchema }),
  z.strictObject({ kind: z.literal("director") }),
  z.strictObject({ kind: z.literal("audience") }),
  z.strictObject({ kind: z.literal("video"), publicationId: z.uuid() }),
]);
export type EsportsChannel = z.infer<typeof esportsChannelSchema>;

export function esportsSeatLimit(seat: EsportsSeat) {
  return seat.kind === "player"
    ? ESPORTS_LIMITS.playersPerTeam
    : seat.kind === "director"
      ? ESPORTS_LIMITS.directors
      : ESPORTS_LIMITS.audience;
}
export function esportsChannelName(roomId: string, raw: EsportsChannel) {
  const parent = z.uuid().parse(roomId),
    channel = esportsChannelSchema.parse(raw);
  return `cg-esports/${parent}/${channel.kind}${channel.kind === "team" ? "/" + channel.team : channel.kind === "video" ? "/" + channel.publicationId : ""}`;
}
// Static channel rights only. The server must also validate the current seat
// revision, credential and watched/warming publication before issuing/admitting.
export function esportsMediaRights(
  seat: EsportsSeat,
  channel: EsportsChannel,
  ownVideo = false,
) {
  if (channel.kind === "video")
    return {
      publish: seat.kind === "player" && ownVideo,
      subscribe: seat.kind !== "player" && !ownVideo,
    };
  if (channel.kind === "team") {
    const sameTeam = seat.kind === "player" && seat.team === channel.team;
    return { publish: sameTeam, subscribe: sameTeam || seat.kind !== "player" };
  }
  const sameSeat = seat.kind === channel.kind;
  return { publish: sameSeat, subscribe: sameSeat };
}
export function esportsOwnVoice(seat: EsportsSeat): EsportsChannel {
  return seat.kind === "player"
    ? { kind: "team", team: seat.team }
    : { kind: seat.kind };
}
export const esportsMemberSchema = z.object({
  userId: z.uuid(),
  displayName: z.string(),
  seat: esportsSeatSchema,
  revision: z.number().int().positive(),
  online: z.boolean(),
  reservedUntil: z.iso.datetime({ offset: true }).nullable(),
  microphoneAllowed: z.boolean(),
  sharingAllowed: z.boolean(),
});
export const esportsPublicationSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  status: z.enum(["starting", "active"]),
  systemAudio: z.boolean(),
});
export const esportsWatchSchema = z.object({
  revision: z.number().int().nonnegative(),
  current: z.uuid().nullable(),
  warming: z.uuid().nullable(),
  warmDeadline: z.iso.datetime({ offset: true }).nullable(),
  monitorTeam: esportsTeamSchema.nullable(),
  autoMonitor: z.boolean(),
});
export const esportsSnapshotSchema = z.object({
  roomId: z.uuid(),
  ownerUserId: z.uuid(),
  members: z.array(esportsMemberSchema).max(20),
  publications: z.array(esportsPublicationSchema).max(10),
  self: esportsMemberSchema,
  watch: esportsWatchSchema,
});
export type EsportsSnapshot = z.infer<typeof esportsSnapshotSchema>;
export const esportsWatchInput = z
  .strictObject({
    action: z.enum(["select", "commit", "cancel", "stop"]),
    publicationId: z.uuid().optional(),
    revision: z.number().int().nonnegative(),
  })
  .superRefine((v, ctx) => {
    if (v.action === "select" && !v.publicationId)
      ctx.addIssue({
        code: "custom",
        path: ["publicationId"],
        message: "请选择选手画面",
      });
  });
export const esportsMonitorInput = z
  .strictObject({
    enabled: z.boolean().optional(),
    autoMonitor: z.boolean().optional(),
  })
  .refine(
    (v) => v.enabled !== undefined || v.autoMonitor !== undefined,
    "请选择收听设置",
  );
export const esportsConnectionInput = z.strictObject({
  channel: esportsChannelSchema,
  seatRevision: z.number().int().positive(),
  watchRevision: z.number().int().nonnegative().optional(),
});
export const esportsConnectionSchema = z.object({
  channel: z.string(),
  url: z.string(),
  token: z.string(),
  seatRevision: z.number().int().positive(),
});
export const esportsNativeInput = z.strictObject({
  leaseId: z.uuid(),
  revision: z.number().int().positive(),
  systemAudio: z.boolean().default(false),
});
