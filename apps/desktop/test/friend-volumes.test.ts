import { expect, test } from "bun:test";
import { FriendVolumes } from "../src/renderer/friend-volumes";
const peer = (volume = 100) => ({
  userId: "friend",
  status: "accepted" as const,
  volume,
});
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
function fixture() {
  const saves: {
    owner: string;
    id: string;
    volume: number;
    resolve: () => void;
    reject: (error: Error) => void;
  }[] = [];
  let levels: Record<string, number> = {};
  const memory = new FriendVolumes(
    (id, volume, owner) =>
      new Promise<void>((resolve, reject) =>
        saves.push({ id, volume, owner, resolve, reject }),
      ),
    (values) => {
      levels = values;
    },
  );
  return { memory, saves, levels: () => levels };
}
test("server volumes restore without persisting, and polling cannot overwrite an active edit", async () => {
  const { memory, saves, levels } = fixture();
  memory.sync("alice", [peer(175)]);
  expect(levels()).toEqual({ friend: 175 });
  expect(saves).toHaveLength(0);
  memory.change("friend", 40);
  memory.sync("alice", [peer(175)]);
  expect(levels().friend).toBe(40);
  const save = memory.commit("friend", 40);
  await tick();
  expect(saves[0]).toMatchObject({ owner: "alice", volume: 40 });
  memory.sync("alice", [peer(175)]);
  expect(levels().friend).toBe(40);
  saves[0]!.resolve();
  await save;
  memory.sync("alice", [peer(40)]);
  expect(levels().friend).toBe(40);
});
test("edits apply immediately while superseded queued saves are skipped", async () => {
  const { memory, saves, levels } = fixture();
  memory.sync("alice", [peer()]);
  const first = memory.commit("friend", 160);
  await tick();
  const skipped = memory.commit("friend", 50),
    last = memory.commit("friend", 180);
  expect(levels().friend).toBe(180);
  saves[0]!.resolve();
  await first;
  await skipped;
  await tick();
  expect(saves.map((s) => s.volume)).toEqual([160, 180]);
  saves[1]!.resolve();
  await last;
});
test("account switching clears transient levels and fences queued old-account saves", async () => {
  const { memory, saves, levels } = fixture();
  memory.sync("alice", [peer(150)]);
  const first = memory.commit("friend", 160);
  await tick();
  const queued = memory.commit("friend", 170);
  memory.change("stranger", 20);
  memory.sync(undefined, []);
  expect(levels()).toEqual({});
  memory.sync("bob", [peer(25)]);
  saves[0]!.reject(Error("old session ended"));
  await first;
  await queued;
  expect(levels()).toEqual({ friend: 25 });
  expect(saves).toHaveLength(1);
});
test("nonfriends remain transient and removing a friend never raises the current playback level", async () => {
  const { memory, saves, levels } = fixture();
  memory.sync("alice", [peer(0)]);
  memory.sync("alice", []);
  expect(levels().friend).toBe(0);
  await memory.commit("friend", 15);
  await memory.commit("stranger", 80);
  expect(saves).toHaveLength(0);
  memory.sync("alice", []);
  expect(levels()).toEqual({ friend: 15, stranger: 80 });
  memory.sync("alice", [peer()]);
  expect(levels().friend).toBe(100);
});
test("failed persistence keeps local playback and permits an explicit retry", async () => {
  const { memory, saves, levels } = fixture();
  memory.sync("alice", [peer()]);
  const first = memory.commit("friend", 0);
  await tick();
  const rejected = first.then(
    () => undefined,
    (error) => error as Error,
  );
  saves[0]!.reject(Error("network"));
  expect((await rejected)?.message).toBe("network");
  memory.sync("alice", [peer()]);
  expect(levels().friend).toBe(0);
  const retry = memory.commit("friend", 0);
  await tick();
  saves[1]!.resolve();
  await retry;
  memory.sync("alice", [peer(0)]);
  expect(levels().friend).toBe(0);
});
test("older servers use 100 percent and local inputs stay within the existing bounds", async () => {
  const { memory, levels } = fixture();
  memory.sync("alice", [{ userId: "friend", status: "accepted" }]);
  expect(levels().friend).toBe(100);
  memory.change("friend", 400);
  expect(levels().friend).toBe(200);
  memory.change("friend", -1);
  expect(levels().friend).toBe(0);
  memory.change("friend", 79.6);
  expect(levels().friend).toBe(80);
});
