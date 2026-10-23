import type { RoomInfo, RoomState } from "@cinegather/contracts";
export interface RoomDependencies {
  join(
    roomId: string,
    inviteToken?: string,
    password?: string,
  ): Promise<{ room: RoomInfo; token: string; url: string }>;
  leave(roomId: string): Promise<void>;
  connect(url: string, token: string): Promise<void>;
  disconnect(): Promise<void>;
  stopShare(): Promise<void>;
  changed(state: RoomState, room: RoomInfo | undefined, revision: number): void;
  error(error: unknown): void;
}
export class RoomCoordinator {
  private revision = 0;
  private roomId?: string;
  private entering = false;
  private entry?: { roomId: string; inviteToken?: string; password?: string };
  constructor(private readonly deps: RoomDependencies) {}
  async enter(roomId: string, inviteToken?: string, password?: string) {
    if (this.entering) return;
    if (this.roomId) await this.leave();
    this.entering = true;
    const revision = ++this.revision;
    this.deps.changed("joining", undefined, this.revision);
    let admittedRoomId: string | undefined;
    let admittedRoom: RoomInfo | undefined;
    try {
      const result = await this.deps.join(roomId, inviteToken, password);
      admittedRoomId = result.room.id;
      admittedRoom = result.room;
      if (revision !== this.revision) {
        await this.safeLeave(admittedRoomId);
        return;
      }
      this.roomId = admittedRoomId;
      this.entry = { roomId: admittedRoomId, inviteToken, password };
      await this.deps.connect(result.url, result.token);
      if (revision !== this.revision) {
        await this.deps.disconnect();
        await this.safeLeave(admittedRoomId);
        return;
      }
      this.deps.changed("connected", result.room, this.revision);
    } catch (error) {
      await this.deps.disconnect();
      if (admittedRoomId) await this.safeLeave(admittedRoomId);
      if (revision === this.revision) {
        this.roomId = undefined;
        if (!admittedRoomId) this.entry = undefined;
        this.deps.changed("failed", admittedRoom, this.revision);
        this.deps.error(error);
      }
    } finally {
      this.entering = false;
    }
  }
  async retry() {
    const entry = this.entry;
    if (entry)
      await this.enter(entry.roomId, entry.inviteToken, entry.password);
  }
  private async safeLeave(roomId: string) {
    try {
      await this.deps.leave(roomId);
    } catch (error) {
      this.deps.error(error);
    }
  }
  async leave(notifyServer = true) {
    ++this.revision;
    const roomId = this.roomId;
    this.roomId = undefined;
    this.entry = undefined;
    this.deps.changed("leaving", undefined, this.revision);
    try {
      await this.deps.disconnect();
    } finally {
      try {
        await this.deps.stopShare();
      } finally {
        if (roomId && notifyServer) await this.safeLeave(roomId);
        this.deps.changed("idle", undefined, this.revision);
      }
    }
  }
}
