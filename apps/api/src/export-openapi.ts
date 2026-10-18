import { mkdir, writeFile } from 'node:fs/promises';
import { createApp, openapi, closeDatabase } from './app';
const app = await createApp();
try {
  await app.init();
  await mkdir('docs/api', { recursive: true });
  await writeFile('docs/api/openapi.json', JSON.stringify(openapi(app), null, 2));
} finally { await app.close(); await closeDatabase(); }
