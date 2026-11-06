import { expect, test } from "bun:test";
import { db } from "../../apps/api/src/context";
import { partyWordBank } from "@cinegather/database";
import { eq, sql } from "drizzle-orm";
import { partyWordSeed } from "../../apps/api/src/party-word-seed";
test("clue migration corrects original content but preserves edits, disabled state and deletions", async () => {
  if (!process.env.DATABASE_URL?.includes("activities_tests"))
    throw Error("isolated test database required");
  const migration = await Bun.file(
    new URL(
      "../../packages/database/migrations/0030_party_word_clue_quality.sql",
      import.meta.url,
    ),
  ).text();
  const original = await Bun.file(
    new URL(
      "../../packages/database/migrations/0028_party_word_bank.sql",
      import.meta.url,
    ),
  ).text();
  // Pull known seed IDs and their original values from the immutable initial migration.
  const row = (answer: string) => {
    const line = original.split("\n").find((l) => l.includes(`,'${answer}',`))!;
    const id = line.match(/^\('([^']+)'/)![1]!;
    const clues = JSON.parse(line.match(/,'(\[.*\])'::jsonb/)![1]!) as string[];
    return { id, clues };
  };
  const piano = row("钢琴"),
    guitar = row("吉他"),
    flower = row("向日葵");
  const rollback = new Error("rollback fixture");
  try {
    await db.transaction(async (tx) => {
      await tx
        .update(partyWordBank)
        .set({ clues: piano.clues, enabled: false, version: 8 })
        .where(eq(partyWordBank.id, piano.id));
      const custom = [
        "管理员手工线索一",
        "管理员手工线索二",
        "管理员手工线索三",
      ];
      await tx
        .update(partyWordBank)
        .set({ clues: custom, version: 8 })
        .where(eq(partyWordBank.id, guitar.id));
      await tx.delete(partyWordBank).where(eq(partyWordBank.id, flower.id));
      await tx.execute(sql.raw(migration));
      const [updated] = await tx
        .select()
        .from(partyWordBank)
        .where(eq(partyWordBank.id, piano.id));
      expect(updated!.clues).toEqual(
        partyWordSeed.find((w) => w.answer === "钢琴")!.clues,
      );
      expect(updated!.enabled).toBe(false);
      expect(updated!.version).toBe(9);
      const [edited] = await tx
        .select()
        .from(partyWordBank)
        .where(eq(partyWordBank.id, guitar.id));
      expect(edited!.clues).toEqual(custom);
      expect(edited!.version).toBe(8);
      expect(
        await tx
          .select()
          .from(partyWordBank)
          .where(eq(partyWordBank.id, flower.id)),
      ).toHaveLength(0);
      await tx.execute(sql.raw(migration));
      const [again] = await tx
        .select()
        .from(partyWordBank)
        .where(eq(partyWordBank.id, piano.id));
      expect(again!.version).toBe(9);
      throw rollback;
    });
  } catch (e) {
    if (e !== rollback) throw e;
  }
});
