import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createApp } from '../../apps/api/src/app';
import { createDatabase, credentials, invites, users } from '@cinegather/database';
import { eq } from 'drizzle-orm';
import type { INestApplication } from '@nestjs/common';
let app: INestApplication;
let base: string;
const { db, pool } = createDatabase(process.env.DATABASE_URL!);
const createdUsers: string[] = [];
async function req(path: string, token?: string, body?: unknown, method = body ? 'POST' : 'GET', key?: string) {
  const response = await fetch(`${base}/api/v1${path}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, body: await response.json() };
}
async function guest(name = '集成测试') {
  const r = await req('/guests', undefined, { displayName: name });
  expect(r.status).toBe(201);
  createdUsers.push(r.body.user.id);
  return { id: r.body.user.id as string, token: r.body.sessionToken as string };
}
async function room(token: string, maxMembers = 5, key?: string) {
  const r = await req('/rooms', token, { name: '测试放映室', maxMembers }, 'POST', key);
  expect(r.status).toBe(201);
  return r.body as { id: string; name: string; maxMembers: number };
}
beforeAll(async () => { app = await createApp(); await app.listen(0, '127.0.0.1'); base = await app.getUrl(); });
afterAll(async () => { await app?.close(); await pool.end(); });

describe('real PostgreSQL and LiveKit API boundaries', () => {
  test('health actually checks database and SFU; anonymous room operations are rejected', async () => {
    expect((await req('/health')).status).toBe(200);
    expect((await req('/rooms', undefined, { name: 'forged' })).status).toBe(401);
    expect((await req('/guests', undefined, { displayName: '   ' })).status).toBe(400);
  });
  test('guest identity and invite secrets are never stored in plaintext; private rooms do not leak', async () => {
    const a = await guest(); const b = await guest(); const r = await room(a.token);
    const stored = await db.select().from(credentials).where(eq(credentials.userId, a.id));
    expect(stored[0]?.secretHash).not.toBe(a.token);
    expect(stored[0]?.secretHash.length).toBe(64);
    expect((await req(`/rooms/${r.id}`, b.token)).status).toBe(403);
    const invitation = await req(`/rooms/${r.id}/invites`, a.token, { maxUses: 1 });
    expect(invitation.status).toBe(201);
    const storedInvite = await db.select().from(invites).where(eq(invites.id, invitation.body.id));
    expect(storedInvite[0]?.tokenHash).not.toBe(invitation.body.token);
    const join = await req(`/rooms/${r.id}/join`, b.token, { inviteToken: invitation.body.token });
    expect(join.status).toBe(201);
    const claims = JSON.parse(Buffer.from(join.body.token.split('.')[1], 'base64url').toString());
    expect(claims.sub).toBe(b.id);
    expect(claims.video.canPublishSources).toEqual(['microphone']);
    const c = await guest();
    expect((await req(`/rooms/${r.id}/join`, c.token, { inviteToken: invitation.body.token })).status).toBe(403);
    expect((await req(`/rooms/${r.id}/join`, b.token, {})).status).toBe(201);
  });
  test('idempotency survives retries and rejects using the same key for a different request', async () => {
    const a = await guest(); const key = crypto.randomUUID();
    const first = await room(a.token, 5, key); const again = await room(a.token, 5, key);
    expect(again.id).toBe(first.id);
    expect((await req('/rooms', a.token, { name: '另一个房间' }, 'POST', key)).status).toBe(409);
  });
  test('parallel joins cannot exceed capacity, and a leave frees its admission', async () => {
    const a = await guest(); const b = await guest(); const c = await guest(); const r = await room(a.token, 2);
    const invitation = await req(`/rooms/${r.id}/invites`, a.token, {});
    expect((await req(`/rooms/${r.id}/join`, a.token, {})).status).toBe(201);
    const attempts = await Promise.all([b, c].map(p => req(`/rooms/${r.id}/join`, p.token, { inviteToken: invitation.body.token })));
    expect(attempts.map(x => x.status).sort()).toEqual([201, 409]);
    expect((await req(`/rooms/${r.id}/leave`, a.token, {})).status).toBe(201);
    const lost = attempts[0]?.status === 409 ? b : c;
    expect((await req(`/rooms/${r.id}/join`, lost.token, { inviteToken: invitation.body.token })).status).toBe(201);
  });
  test('moderation, chat and invite revocation enforce room membership and owner permissions', async () => {
    const a = await guest(); const b = await guest(); const r = await room(a.token);
    const invitation = await req(`/rooms/${r.id}/invites`, a.token, {});
    await req(`/rooms/${r.id}/join`, b.token, { inviteToken: invitation.body.token });
    expect((await req(`/rooms/${r.id}/members/${a.id}`, b.token, { ban: true }, 'DELETE')).status).toBe(403);
    expect((await req(`/rooms/${r.id}/messages`, b.token, { body: '你好，映聚' })).status).toBe(201);
    const messages = await req(`/rooms/${r.id}/messages`, a.token);
    expect(messages.body.items.some((m: { body: string }) => m.body === '你好，映聚')).toBe(true);
    expect((await req(`/rooms/${r.id}/members/${b.id}`, a.token, { ban: true }, 'DELETE')).status).toBe(200);
    expect((await req(`/rooms/${r.id}/join`, b.token, {})).status).toBe(403);
    expect((await req(`/rooms/${r.id}/messages`, b.token, { body: 'forbidden' })).status).toBe(403);
    expect((await req(`/rooms/${r.id}/invites/${invitation.body.id}`, a.token, undefined, 'DELETE')).status).toBe(200);
    const c = await guest();
    expect((await req(`/rooms/${r.id}/join`, c.token, { inviteToken: invitation.body.token })).status).toBe(403);
  });
  test('friend requests require recipient acceptance and may be removed by either party', async () => {
    const a = await guest(); const b = await guest();
    expect((await req('/friends', a.token, { userId: b.id })).status).toBe(201);
    expect((await req(`/friends/${b.id}/accept`, a.token, {})).status).toBe(404);
    expect((await req(`/friends/${a.id}/accept`, b.token, {})).status).toBe(201);
    expect((await req('/friends', a.token)).body.items[0].status).toBe('accepted');
    expect((await req(`/friends/${a.id}`, b.token, undefined, 'DELETE')).status).toBe(200);
    expect((await req('/friends', a.token)).body.items).toHaveLength(0);
    expect((await req('/friends', a.token, { userId: a.id })).status).toBe(400);
  });
  test('revoking a guest session invalidates its bearer immediately', async () => {
    const a = await guest();
    expect((await req('/me', a.token)).status).toBe(200);
    expect((await req('/session', a.token, undefined, 'DELETE')).status).toBe(200);
    expect((await req('/me', a.token)).status).toBe(401);
    expect((await db.select().from(users).where(eq(users.id, a.id)))).toHaveLength(1);
  });
});
