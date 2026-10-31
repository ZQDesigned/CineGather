import { expect, test } from "bun:test";
import * as core from "../src";
import type { RoomInfo } from "@cinegather/contracts";
type Scope = { roomId: string; session: string; revision: number };
type Sync = { refresh(): Promise<void> };
function sync(deps: {
  scope(): Scope | undefined;
  read(roomId: string): Promise<RoomInfo>;
  apply(room: RoomInfo): void;
}): Sync {
  const Constructor = Reflect.get(core, "RoomSnapshotSync");
  expect(Constructor).toBeDefined();
  return new Constructor(deps);
}
function room(id = "room-a", owner = "other"): RoomInfo {
  return {
    id,
    code: "ABCDEF12",
    name: "房间",
    ownerUserId: owner,
    access: "normal",
    maxMembers: 5,
    role: owner === "me" ? "owner" : "member",
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const turn = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
test("ownership updates the joined room without re-entering and concurrent triggers share one read", async () => {
  const next = deferred<RoomInfo>();
  let reads = 0;
  const applied: RoomInfo[] = [];
  const subject = sync({
    scope: () => ({ roomId: "room-a", session: "session-a", revision: 1 }),
    read: async () => {
      reads++;
      return next.promise;
    },
    apply: (r) => applied.push(r),
  });
  const first = subject.refresh();
  const second = subject.refresh();
  await turn();
  expect(reads).toBe(1);
  next.resolve(room("room-a", "me"));
  await Promise.all([first, second]);
  expect(applied.map((r) => [r.ownerUserId, r.role])).toEqual([
    ["me", "owner"],
  ]);
});
test("a blocked old room read neither delays a new room nor replaces its state", async () => {
  let scope: Scope = { roomId: "room-a", session: "session-a", revision: 1 };
  const old = deferred<RoomInfo>();
  const applied: RoomInfo[] = [];
  const subject = sync({
    scope: () => scope,
    read: async (id) => (id === "room-a" ? old.promise : room(id, "me")),
    apply: (r) => applied.push(r),
  });
  const first = subject.refresh();
  await turn();
  scope = { ...scope, roomId: "room-b", revision: 2 };
  await subject.refresh();
  expect(applied.map((r) => r.id)).toEqual(["room-b"]);
  old.resolve(room());
  await first;
  expect(applied.map((r) => r.id)).toEqual(["room-b"]);
});
test("leaving and rejoining the same room invalidates the earlier admission response", async () => {
  let scope: Scope | undefined = {
    roomId: "room-a",
    session: "session-a",
    revision: 1,
  };
  const old = deferred<RoomInfo>();
  let reads = 0;
  const applied: RoomInfo[] = [];
  const subject = sync({
    scope: () => scope,
    read: async () => (++reads === 1 ? old.promise : room("room-a", "me")),
    apply: (r) => applied.push(r),
  });
  const first = subject.refresh();
  await turn();
  scope = undefined;
  await subject.refresh();
  scope = { roomId: "room-a", session: "session-a", revision: 3 };
  await subject.refresh();
  old.resolve(room());
  await first;
  expect(applied.map((r) => r.ownerUserId)).toEqual(["me"]);
});
test("switching accounts or logging out discards in-flight room snapshots", async () => {
  for (const session of [undefined, "session-b"]) {
    let scope: Scope | undefined = {
      roomId: "room-a",
      session: "session-a",
      revision: 1,
    };
    const pending = deferred<RoomInfo>();
    const applied: RoomInfo[] = [];
    const subject = sync({
      scope: () => scope,
      read: () => pending.promise,
      apply: (r) => applied.push(r),
    });
    const first = subject.refresh();
    await turn();
    scope = session ? { roomId: "room-a", session, revision: 1 } : undefined;
    pending.resolve(room());
    await first;
    expect(applied).toEqual([]);
  }
});
test("failed reads can retry, and a response for a different room is never applied", async () => {
  let reads = 0;
  const applied: RoomInfo[] = [];
  const subject = sync({
    scope: () => ({ roomId: "room-a", session: "session-a", revision: 1 }),
    read: async () => {
      if (++reads === 1) throw Error("offline");
      return room(reads === 2 ? "wrong-room" : "room-a", "me");
    },
    apply: (r) => applied.push(r),
  });
  await expect(subject.refresh()).rejects.toThrow("offline");
  await subject.refresh();
  expect(applied).toEqual([]);
  await subject.refresh();
  expect(applied.map((r) => r.ownerUserId)).toEqual(["me"]);
});

test("a failed response from a previous admission cannot surface an error in the new room", async () => {
  let scope: Scope = { roomId: "room-a", session: "session-a", revision: 1 };
  const old = deferred<RoomInfo>();
  const subject = sync({
    scope: () => scope,
    read: () => old.promise,
    apply: () => {},
  });
  const pending = subject.refresh();
  await turn();
  scope = { ...scope, revision: 2 };
  old.reject(Error("old connection lost"));
  await expect(pending).resolves.toBeUndefined();
});
