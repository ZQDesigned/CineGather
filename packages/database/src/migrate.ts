import { createDatabase } from './index';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL missing. Run bun run setup.');
const { db, pool } = createDatabase(process.env.DATABASE_URL);
try {
  await db.execute('SELECT pg_advisory_lock(839214)');
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  console.log('Database migrations applied.');
} finally { await pool.end(); }
