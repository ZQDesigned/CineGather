import { describe, expect, test } from 'bun:test';
import { guestInput, roomInput, joinInput, leaseInput, messageInput } from '../src';

describe('untrusted client input', () => {
  test('rejects empty names and forged identities rather than trusting a userId', () => {
    expect(guestInput.safeParse({ displayName: '   ' }).success).toBe(false);
    expect(guestInput.safeParse({ displayName: '小映', userId: 'forged' }).success).toBe(false);
    expect(guestInput.parse({ displayName: '  小映  ' })).toEqual({ displayName: '小映' });
  });
  test('enforces private room capacity between two and ten', () => {
    expect(roomInput.safeParse({ name: '影院', maxMembers: 11 }).success).toBe(false);
    expect(roomInput.safeParse({ name: '影院', maxMembers: 1 }).success).toBe(false);
    expect(roomInput.parse({ name: '影院' })).toEqual({ name: '影院', maxMembers: 5 });
  });
  test('does not accept malformed invitations, stale lease references or empty chat', () => {
    expect(joinInput.safeParse({ inviteToken: 'short' }).success).toBe(false);
    expect(leaseInput.safeParse({ leaseId: 'bad', revision: 0 }).success).toBe(false);
    expect(messageInput.safeParse({ body: '\n ' }).success).toBe(false);
  });
});
