import { randomUUID } from "node:crypto";
import { inArray, isNull, and } from "drizzle-orm";
import { users, type Transaction } from "@cinegather/database";
import { pointsRulesSchema } from "@cinegather/contracts";
import { tickPartyGame, type PartyGame } from "../party/party-game";
import { readPointsPolicy, settlePoints } from "./service";

/** Adapter boundary: generic accounting never inspects a game's board or answers. */
export async function syncPartyRewards(
  tx: Transaction,
  roomId: string,
  before: PartyGame,
  after: PartyGame,
  requestTrace?: string,
  actorId?: string,
) {
  const game = `party.${after.kind}` as const;
  if (
    before.roundId === after.roundId &&
    after.matchId &&
    after.roundId &&
    after.rewardPolicy
  ) {
    const policy = after.rewardPolicy,
      rates = policy.rules.games[game];
    const candidates: {
      userId: string;
      reward: "correct" | "painter";
      attempt: number;
    }[] = after.solvedIds
      .filter((id) => !before.solvedIds.includes(id))
      .map((userId) => ({
        userId,
        reward: "correct" as const,
        attempt: after.guessAttempts?.[userId] ?? 3,
      }));
    if (
      after.roundCompleted &&
      !before.roundCompleted &&
      after.kind === "draw" &&
      after.drewThisRound &&
      after.drawerId
    )
      candidates.push({
        userId: after.drawerId,
        reward: "painter",
        attempt: 0,
      });
    // Disabled/deleted accounts cannot receive rewards; their departure must not block other players.
    const eligible = candidates.length
      ? await tx
          .select({ id: users.id })
          .from(users)
          .where(
            and(
              inArray(
                users.id,
                candidates.map((c) => c.userId),
              ),
              isNull(users.disabledAt),
            ),
          )
      : [];
    const traceId = requestTrace ?? randomUUID();
    for (const c of candidates
      .filter((c) => eligible.some((a) => a.id === c.userId))
      .sort((a, b) => a.userId.localeCompare(b.userId))) {
      await settlePoints(tx, {
        ...c,
        roomId,
        game,
        matchId: after.matchId,
        roundId: after.roundId,
        policy,
        traceId,
        facts: {
          question: after.word?.answer ?? null,
          category: after.word?.category ?? null,
          round: after.round,
          normalCompletion: after.roundCompleted ?? false,
          drew: after.drewThisRound ?? false,
          actorId: actorId ?? null,
        },
        expected:
          c.reward === "painter"
            ? rates.painter
            : c.attempt === 1
              ? rates.firstCorrect
              : c.attempt === 2
                ? rates.firstCorrect / 2
                : 0,
      });
    }
  }
  if (after.roundId && before.roundId !== after.roundId) {
    const policy = await readPointsPolicy(tx);
    after.rewardPolicy = {
      version: policy.version,
      rules: pointsRulesSchema.parse({
        enabled: policy.enabled,
        dailyCap: policy.dailyCap,
        games: policy.games,
      }),
    };
  }
  return after;
}
export async function advancePartyRewards(
  tx: Transaction,
  roomId: string,
  input: PartyGame,
  now: number,
  requestTrace?: string,
  actorId?: string,
) {
  return syncPartyRewards(
    tx,
    roomId,
    input,
    tickPartyGame(input, now),
    requestTrace,
    actorId,
  );
}
