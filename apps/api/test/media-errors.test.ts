import { expect, test } from "bun:test";
import { media } from "../src/media";
test("LiveKit's missing in-memory room response is absent state while other internal errors remain failures", async () => {
  const original = media.client.listParticipants;
  try {
    media.client.listParticipants = async () => {
      throw Object.assign(new Error("could not find object"), {
        code: "unknown",
      });
    };
    expect(await media.participants(crypto.randomUUID())).toEqual([]);
    media.client.listParticipants = async () => {
      throw Object.assign(new Error("backend unavailable"), {
        code: "unknown",
      });
    };
    await expect(media.participants(crypto.randomUUID())).rejects.toThrow(
      "backend unavailable",
    );
  } finally {
    media.client.listParticipants = original;
  }
});

test("presence verification filters stale Redis participants whose serving node no longer responds", async () => {
  const list = media.client.listParticipants,
    update = media.client.updateParticipant;
  try {
    media.client.listParticipants = async () =>
      [{ identity: crypto.randomUUID() }] as Awaited<ReturnType<typeof list>>;
    media.client.updateParticipant = async () => {
      throw Object.assign(new Error("no response from servers"), {
        code: "unavailable",
      });
    };
    expect(await media.participants(crypto.randomUUID(), true)).toEqual([]);
    media.client.updateParticipant = async () => {
      throw new Error("unexpected control failure");
    };
    await expect(media.participants(crypto.randomUUID(), true)).rejects.toThrow(
      "unexpected control failure",
    );
  } finally {
    media.client.listParticipants = list;
    media.client.updateParticipant = update;
  }
});
