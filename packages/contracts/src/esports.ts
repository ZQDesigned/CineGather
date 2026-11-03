import { z } from "zod";

export const ESPORTS_LIMITS = {
  teams: 6,
  playersPerTeam: 5,
  directors: 5,
  audience: 5,
  total: 52,
  coachesPerTeam: 2,
} as const;
export const ESPORTS_FEATURE = "esports-v1";
export const ESPORTS_RESERVATION_MS = 120_000;
export const ESPORTS_PREWARM_MS = 5_000;
export const DYNAMIC_ESPORTS_FEATURE = "esports-v2";
export const esportsTeamSchema = z
  .string()
  .min(1)
  .max(36)
  .regex(/^[a-z0-9][a-z0-9-]*$/);
export const esportsGroupSchema = z.strictObject({
  id: esportsTeamSchema,
  name: z.string().trim().min(1).max(24),
  playerSeats: z.number().int().min(1).max(5),
  coachSeats: z.number().int().min(0).max(2),
});
export const esportsConfigurationSchema = z
  .strictObject({
    groups: z.array(esportsGroupSchema).min(1).max(6),
    tacticalPauseSeconds: z.number().int().min(1).max(3600),
  })
  .superRefine((c, ctx) => {
    for (const key of ["id", "name"] as const)
      if (new Set(c.groups.map((g) => g[key])).size !== c.groups.length)
        ctx.addIssue({
          code: "custom",
          path: ["groups"],
          message: key === "id" ? "分组不能重复" : "分组名称不能重复",
        });
  });
export type EsportsConfiguration = z.infer<typeof esportsConfigurationSchema>;
export const defaultEsportsConfiguration: EsportsConfiguration = {
  groups: [
    { id: "a", name: "A 组", playerSeats: 5, coachSeats: 0 },
    { id: "b", name: "B 组", playerSeats: 5, coachSeats: 0 },
  ],
  tacticalPauseSeconds: 60,
};
export const esportsSettingsInput = z.strictObject({
  revision: z.number().int().positive(),
  name: z.string().trim().min(1).max(64).optional(),
  configuration: esportsConfigurationSchema,
});
export const coachVoiceModeSchema = z.enum(["auto", "open", "closed"]);
export type CoachVoiceMode = z.infer<typeof coachVoiceModeSchema>;
export function coachVoiceAllowed(
  mode: CoachVoiceMode,
  until: Date | string | null | undefined,
  now = Date.now(),
) {
  return (
    mode === "open" ||
    (mode === "auto" && !!until && new Date(until).getTime() > now)
  );
}
export function esportsCapacityTotal(config: EsportsConfiguration) {
  return config.groups.reduce((n, g) => n + g.playerSeats + g.coachSeats, 10);
}
export function esportsTeamName(config: EsportsConfiguration, team: string) {
  return config.groups.find((g) => g.id === team)?.name ?? "分组";
}
export function requiresDynamicEsports(
  config: EsportsConfiguration,
  mode: CoachVoiceMode = "auto",
  pauseUntil?: Date | string | null,
) {
  return (
    JSON.stringify(config) !== JSON.stringify(defaultEsportsConfiguration) ||
    mode !== "auto" ||
    !!pauseUntil
  );
}
export const esportsSeatSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("player"), team: esportsTeamSchema }),
  z.strictObject({ kind: z.literal("coach"), team: esportsTeamSchema }),
  z.strictObject({ kind: z.literal("director") }),
  z.strictObject({ kind: z.literal("audience") }),
]);
export type EsportsSeat = z.infer<typeof esportsSeatSchema>;
export function esportsSeatChoices(
  config = defaultEsportsConfiguration,
): { key: string; label: string; seat: EsportsSeat }[] {
  return [
    ...config.groups.flatMap((g) => [
      {
        key: `player-${g.id}`,
        label: `${g.name}选手`,
        seat: { kind: "player" as const, team: g.id },
      },
      ...(g.coachSeats
        ? [
            {
              key: `coach-${g.id}`,
              label: `${g.name}教练`,
              seat: { kind: "coach" as const, team: g.id },
            },
          ]
        : []),
    ]),
    { key: "director", label: "导播席", seat: { kind: "director" } },
    { key: "audience", label: "观众席", seat: { kind: "audience" } },
  ];
}
export const esportsChannelSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("team"), team: esportsTeamSchema }),
  z.strictObject({ kind: z.literal("director") }),
  z.strictObject({ kind: z.literal("audience") }),
  z.strictObject({ kind: z.literal("video"), publicationId: z.uuid() }),
]);
export type EsportsChannel = z.infer<typeof esportsChannelSchema>;

export const isTeamSeat = (
  seat: EsportsSeat,
): seat is Extract<EsportsSeat, { kind: "player" | "coach" }> =>
  seat.kind === "player" || seat.kind === "coach";
export function esportsSeatLimit(
  seat: EsportsSeat,
  config = defaultEsportsConfiguration,
) {
  if (isTeamSeat(seat)) {
    const g = config.groups.find((g) => g.id === seat.team);
    return g ? (seat.kind === "coach" ? g.coachSeats : g.playerSeats) : 0;
  }
  return seat.kind === "director"
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
  publisherTeam?: string,
  coachCanSpeak = false,
) {
  if (channel.kind === "video")
    return {
      publish: seat.kind === "player" && ownVideo,
      subscribe:
        !ownVideo &&
        (seat.kind === "coach"
          ? seat.team === publisherTeam
          : seat.kind === "director" || seat.kind === "audience"),
    };
  if (channel.kind === "team") {
    const sameTeam = isTeamSeat(seat) && seat.team === channel.team;
    return {
      publish: sameTeam && (seat.kind === "player" || coachCanSpeak),
      subscribe:
        sameTeam || seat.kind === "director" || seat.kind === "audience",
    };
  }
  const sameSeat = seat.kind === channel.kind;
  return { publish: sameSeat, subscribe: sameSeat };
}
export function esportsOwnVoice(seat: EsportsSeat): EsportsChannel {
  return isTeamSeat(seat)
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
  configuration: esportsConfigurationSchema.optional(),
  configurationRevision: z.number().int().positive().optional(),
  coachVoiceMode: coachVoiceModeSchema.optional(),
  tacticalPauseUntil: z.iso.datetime({ offset: true }).nullable().optional(),
  serverTime: z.iso.datetime({ offset: true }).optional(),
  members: z.array(esportsMemberSchema).max(52),
  publications: z.array(esportsPublicationSchema).max(30),
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
  quality: z.enum(["saver", "cinema", "game"]).optional(),
  leaseId: z.uuid(),
  revision: z.number().int().positive(),
  systemAudio: z.boolean().default(false),
});

export const esportsFriendInviteInput = z.strictObject({
  userId: z.uuid().toLowerCase(),
  seat: esportsSeatSchema.optional(),
});
