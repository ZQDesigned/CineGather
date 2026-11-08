import { expect, test } from "bun:test";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import {
  readFile,
  writeFile,
  mkdtemp,
  mkdir,
  copyFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { isolatedIntegrationUrl } from "../../tools/validation/integration";
import { partyWordSeed } from "../../apps/api/src/modules/party/party-word-seed";

test("game category review moves exact legacy buckets, preserves question edits, and keeps explicit admin placement", async () => {
  const base = process.env.DATABASE_URL!;
  if (!base.includes("activities_tests"))
    throw Error("isolated test database required");
  const url = isolatedIntegrationUrl(base),
    name = url.pathname.slice(1);
  const control = new Pool({ connectionString: base, max: 1 });
  const temporary = await mkdtemp(join(tmpdir(), "cg-party-category-review-"));
  let pool: Pool | undefined;
  try {
    await control.query(`CREATE DATABASE "${name}"`);
    pool = new Pool({ connectionString: url.toString(), max: 1 });
    const source = resolve("packages/database/migrations"),
      journal = JSON.parse(
        await readFile(join(source, "meta/_journal.json"), "utf8"),
      );
    journal.entries = journal.entries.filter(
      (e: { idx: number }) => e.idx < 36,
    );
    await mkdir(join(temporary, "meta"));
    await writeFile(
      join(temporary, "meta/_journal.json"),
      JSON.stringify(journal),
    );
    for (const e of journal.entries)
      await copyFile(
        join(source, e.tag + ".sql"),
        join(temporary, e.tag + ".sql"),
      );
    await migrate(drizzle(pool), { migrationsFolder: temporary });
    const custom = crypto.randomUUID();
    await pool.query(
      "INSERT INTO party_categories(id,name,name_key) VALUES($1,'人工保留分类','人工保留分类')",
      [custom],
    );
    await pool.query(
      "UPDATE party_word_bank SET clues='[\"人工一\",\"人工二\",\"人工三\"]'::jsonb,modes=ARRAY['quiz'],enabled=false,version=7 WHERE answer='丘丘人'",
    );
    await pool.query(
      "UPDATE party_word_bank SET category='人工保留分类',category_id=$1,version=11 WHERE answer='派蒙'",
      [custom],
    );
    const before = (
      await pool.query("SELECT * FROM party_word_bank ORDER BY id")
    ).rows;
    const reviewJournal = JSON.parse(
      await readFile(join(source, "meta/_journal.json"), "utf8"),
    );
    reviewJournal.entries = reviewJournal.entries.filter(
      (e: { idx: number }) => e.idx <= 36,
    );
    await copyFile(
      join(source, "0036_party_game_category_review.sql"),
      join(temporary, "0036_party_game_category_review.sql"),
    );
    await writeFile(
      join(temporary, "meta/_journal.json"),
      JSON.stringify(reviewJournal),
    );
    await migrate(drizzle(pool), { migrationsFolder: temporary });
    const after = (
      await pool.query("SELECT * FROM party_word_bank ORDER BY id")
    ).rows;
    const hilichurl = after.find((w) => w.answer === "丘丘人");
    expect(hilichurl).toMatchObject({
      category: "原神",
      enabled: false,
      modes: ["quiz"],
      clues: ["人工一", "人工二", "人工三"],
      version: 8,
    });
    expect(after.find((w) => w.answer === "派蒙")).toEqual(
      before.find((w) => w.answer === "派蒙"),
    );
    expect(after.find((w) => w.answer === "太阳")).toEqual(
      before.find((w) => w.answer === "太阳"),
    );
    expect(after).toHaveLength(before.length);
    for (const row of after) {
      const previous = before.find((w) => w.id === row.id)!;
      for (const key of ["answer", "answer_key", "clues", "modes", "enabled"])
        expect(row[key], row.answer + ":" + key).toEqual(previous[key]);
      if (row.answer !== "派蒙")
        expect(row.category, row.answer).toBe(
          partyWordSeed.find((w) => w.answer === row.answer)!.category,
        );
    }
    const categories = (
      await pool.query("SELECT * FROM party_categories ORDER BY id")
    ).rows;
    const game = categories.find((c) => c.name === "游戏" && !c.parent_id)!;
    for (const word of after.filter((w) =>
      ["丘丘人", "红石中继器", "精灵球", "林克", "卡比"].includes(w.answer),
    )) {
      expect(categories.find((c) => c.id === word.category_id)!.parent_id).toBe(
        game.id,
      );
    }
    expect(
      categories.every(
        (c) =>
          !c.parent_id ||
          !categories.find((p) => p.id === c.parent_id)?.parent_id,
      ),
    ).toBe(true);
    await migrate(drizzle(pool), { migrationsFolder: temporary });
    expect(
      (await pool.query("SELECT * FROM party_word_bank ORDER BY id")).rows,
    ).toEqual(after);
    expect(
      (await pool.query("SELECT * FROM party_categories ORDER BY id")).rows,
    ).toEqual(categories);
  } finally {
    await pool?.end();
    await control.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1",
      [name],
    );
    await control.query(`DROP DATABASE IF EXISTS "${name}"`);
    await control.end();
    await rm(temporary, { recursive: true, force: true });
  }
});
