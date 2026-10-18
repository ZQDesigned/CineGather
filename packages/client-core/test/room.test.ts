import { test, expect } from 'bun:test';
import { RoomCoordinator, type RoomDependencies } from '../src/room';
test('leaving while join is pending cannot connect a stale room or retain its admission', async () => {
  let resolve!: (result: Awaited<ReturnType<RoomDependencies['join']>>) => void;
  let connected = false; const admissions = new Set<string>(); const states: string[] = [];
  const deps: RoomDependencies = {
    join: () => new Promise(r => { resolve = r; }), leave: async id => { admissions.delete(id); },
    connect: async () => { connected = true; }, disconnect: async () => { connected = false; },
    stopShare: async () => {}, changed: state => { states.push(state); }, error: () => {},
  };
  const session = new RoomCoordinator(deps); const enter = session.enter('room'); await session.leave();
  admissions.add('room'); resolve({ room: { id: 'room', name: '房间', ownerUserId: 'owner', maxMembers: 5, role: 'member' }, token: 'jwt', url: 'ws://local' });
  await enter;
  expect(connected).toBe(false); expect(admissions.size).toBe(0); expect(states.at(-1)).toBe('idle');
});
test('a media connection failure releases server admission and reports failed state', async () => {
  let admission = true; const states: string[] = [];
  const session = new RoomCoordinator({ join: async () => ({ room: { id: 'room', name: '房间', ownerUserId: 'owner', maxMembers: 5, role: 'owner' }, token: 'jwt', url: 'ws://local' }), connect: async () => { throw new Error('ICE failed'); }, disconnect: async () => {}, leave: async () => { admission = false; }, stopShare: async () => {}, changed: s => { states.push(s); }, error: () => {} });
  await session.enter('room'); expect(admission).toBe(false); expect(states.at(-1)).toBe('failed');
});
