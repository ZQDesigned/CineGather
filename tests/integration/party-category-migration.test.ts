import { test, expect } from "bun:test";
import {
  mkdtemp,
  readFile,
  writeFile,
  copyFile,
  mkdir,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { z } from "zod";
import { isolatedIntegrationUrl } from "../../tools/validation/integration";
test("category migration preserves edited legacy questions and optional root ownership, with stable valid IDs on rerun", async () => {
  const base = process.env.DATABASE_URL!;
  if (!base.includes("activities_tests"))
    throw Error("isolated test database required");
  const url = isolatedIntegrationUrl(base),
    name = url.pathname.slice(1),
    control = new Pool({ connectionString: base, max: 1 });
  const dir = await mkdtemp(join(tmpdir(), "cinegather-category-migration-"));
  let pool: Pool | undefined;
  try {
    await control.query(`CREATE DATABASE "${name}"`);
    pool = new Pool({ connectionString: url.toString(), max: 1 });
    const source = resolve("packages/database/migrations");
    const journal = JSON.parse(
      await readFile(join(source, "meta/_journal.json"), "utf8"),
    );
    journal.entries = journal.entries.filter(
      (e: { idx: number }) => e.idx < 35,
    );
    await mkdir(join(dir, "meta"));
    await writeFile(join(dir, "meta/_journal.json"), JSON.stringify(journal));
    for (const entry of journal.entries)
      await copyFile(
        join(source, entry.tag + ".sql"),
        join(dir, entry.tag + ".sql"),
      );
    await migrate(drizzle(pool), { migrationsFolder: dir });
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO party_word_bank(id,answer,answer_key,category,clues,enabled,modes,version) VALUES($1,'人工保留题','人工保留题','未细分分类',$2::jsonb,false,ARRAY['quiz'],7)`,
      [id, JSON.stringify(["手工一", "手工二", "手工三"])],
    );
    const before = (
      await pool.query(
        "SELECT id,answer,answer_key,category,clues,enabled,modes,version,updated_at FROM party_word_bank ORDER BY id",
      )
    ).rows;
    await migrate(drizzle(pool), { migrationsFolder: source });
    expect(
      (
        await pool.query(
          "SELECT id,answer,answer_key,category,clues,enabled,modes,version,updated_at FROM party_word_bank ORDER BY id",
        )
      ).rows,
    ).toEqual(before);
    const assigned = (
      await pool.query(
        `SELECT c.* FROM party_word_bank w JOIN party_categories c ON c.id=w.category_id WHERE w.id=$1`,
        [id],
      )
    ).rows[0];
    expect(assigned).toMatchObject({ name: "未细分分类", parent_id: null });
    expect(z.uuid().safeParse(assigned.id).success).toBe(true);
    const categories = (
      await pool.query("SELECT * FROM party_categories ORDER BY id")
    ).rows;
    expect(categories.every((c) => z.uuid().safeParse(c.id).success)).toBe(
      true,
    );
    const game = categories.find((c) => c.name === "游戏");
    expect(categories.find((c) => c.name === "明日方舟")?.parent_id).toBe(
      game.id,
    );
    await migrate(drizzle(pool), { migrationsFolder: source });
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
    await rm(dir, { recursive: true, force: true });
  }
});
