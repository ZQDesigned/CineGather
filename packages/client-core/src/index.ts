export * from './room';
export * from './share';
export * from './lifecycle';
export function parseInvitation(value: string): { roomId: string; inviteToken?: string } {
  const input = value.trim();
  try {
    const url = new URL(input);
    if (url.protocol !== 'cinegather:') throw new Error('unsupported');
    const roomId = url.searchParams.get('room'); const inviteToken = url.searchParams.get('invite') ?? undefined;
    if (!roomId) throw new Error('missing');
    return { roomId, inviteToken };
  } catch { const [roomId = '', inviteToken] = input.split('/'); return { roomId, inviteToken }; }
}
