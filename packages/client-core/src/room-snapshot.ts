import type { RoomInfo } from "@cinegather/contracts";
export interface RoomSnapshotScope {
  roomId: string;
  session: string;
  revision: number;
}
function same(a: RoomSnapshotScope | undefined, b: RoomSnapshotScope) {
  return (
    a?.roomId === b.roomId &&
    a.session === b.session &&
    a.revision === b.revision
  );
}
// Admission revisions matter even when leaving and rejoining the same room.
// An old request must neither block the new room nor overwrite its permissions.
export class RoomSnapshotSync {
  private flight?: { scope: RoomSnapshotScope; promise: Promise<void> };
  constructor(
    private readonly deps: {
      scope(): RoomSnapshotScope | undefined;
      read(roomId: string, session: string): Promise<RoomInfo>;
      apply(room: RoomInfo): void;
    },
  ) {}
  refresh(): Promise<void> {
    const scope = this.deps.scope();
    if (!scope) return Promise.resolve();
    if (this.flight && same(this.flight.scope, scope))
      return this.flight.promise;
    const flight = { scope, promise: Promise.resolve() };
    this.flight = flight;
    flight.promise = Promise.resolve()
      .then(() => this.deps.read(scope.roomId, scope.session))
      .then((room) => {
        if (room.id === scope.roomId && same(this.deps.scope(), scope))
          this.deps.apply(room);
      })
      .catch((error) => {
        if (same(this.deps.scope(), scope)) throw error;
      })
      .finally(() => {
        if (this.flight === flight) this.flight = undefined;
      });
    return flight.promise;
  }
}
