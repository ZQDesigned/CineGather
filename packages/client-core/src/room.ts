import type { RoomInfo, RoomState } from '@cinegather/contracts';
export interface RoomDependencies {
  join(roomId: string, inviteToken?: string): Promise<{ room: RoomInfo; token: string; url: string }>;
  leave(roomId: string): Promise<void>;
  connect(url: string, token: string): Promise<void>;
  disconnect(): Promise<void>;
  stopShare(): Promise<void>;
  changed(state: RoomState, room?: RoomInfo): void;
  error(error: unknown): void;
}
export class RoomCoordinator {
  private revision = 0;
  private roomId?: string;
  private entering = false;
  constructor(private readonly deps: RoomDependencies) {}
  async enter(roomId: string, inviteToken?: string) {
    if (this.entering) return;
    if (this.roomId) await this.leave();
    this.entering = true;
    const revision = ++this.revision;
    this.roomId = roomId;
    this.deps.changed('joining');
    try {
      const result = await this.deps.join(roomId, inviteToken);
      if (revision !== this.revision) { await this.safeLeave(roomId); return; }
      await this.deps.connect(result.url, result.token);
      if (revision !== this.revision) { await this.deps.disconnect(); await this.safeLeave(roomId); return; }
      this.deps.changed('connected', result.room);
    } catch (error) {
      await this.deps.disconnect(); await this.safeLeave(roomId);
      if (revision === this.revision) { this.roomId = undefined; this.deps.changed('failed'); this.deps.error(error); }
    } finally { this.entering = false; }
  }
  private async safeLeave(roomId: string) { try { await this.deps.leave(roomId); } catch (error) { this.deps.error(error); } }
  async leave() {
    ++this.revision;
    const roomId = this.roomId; this.roomId = undefined;
    this.deps.changed('leaving');
    try { await this.deps.stopShare(); }
    finally { await this.deps.disconnect(); if (roomId) await this.safeLeave(roomId); this.deps.changed('idle'); }
  }
}
