import { expect, test } from "bun:test";
import { MediaGateway } from "../src/media";
import { TrackSource } from "livekit-server-sdk";

test("share permission changes preserve microphone bans and never leave an empty unrestricted publish grant", async () => {
  const gateway = new MediaGateway();
  let permission = {
    canPublish: false,
    canPublishSources: [] as TrackSource[],
  };
  gateway.client.getParticipant = async () =>
    ({ permission }) as Awaited<
      ReturnType<typeof gateway.client.getParticipant>
    >;
  gateway.client.updateParticipant = async (_room, _id, options) => {
    if (!options || typeof options === "string" || !options.permission)
      throw new Error("Expected explicit permissions");
    permission = options.permission as typeof permission;
    return { permission } as Awaited<
      ReturnType<typeof gateway.client.updateParticipant>
    >;
  };
  await gateway.setShare("room", "member", true);
  expect(permission.canPublish).toBe(true);
  expect(permission.canPublishSources).toEqual([
    TrackSource.SCREEN_SHARE,
    TrackSource.SCREEN_SHARE_AUDIO,
  ]);
  await gateway.setShare("room", "member", false);
  expect(permission.canPublish).toBe(false);
  expect(permission.canPublishSources).toEqual([]);
  await gateway.setPermissions("room", "member", true, false);
  expect(permission.canPublishSources).toEqual([TrackSource.MICROPHONE]);
  await gateway.setShare("room", "member", true);
  expect(permission.canPublishSources).toContain(TrackSource.MICROPHONE);
  await gateway.setShare("room", "member", false);
  expect(permission.canPublish).toBe(true);
  expect(permission.canPublishSources).toEqual([TrackSource.MICROPHONE]);
  await gateway.setShare("room", "member", true, false);
  expect(permission.canPublishSources).not.toContain(TrackSource.MICROPHONE);
  await gateway.setShare("room", "member", false, false);
  expect(permission.canPublish).toBe(false);
});

test("owner microphone mute preserves independent accompaniment and screen audio", async () => {
  const gateway = new MediaGateway();
  const muted: { sid: string; mute: boolean }[] = [];
  gateway.client.mutePublishedTrack = async (_room, _id, sid, mute) => {
    muted.push({ sid, mute });
    return {} as Awaited<ReturnType<typeof gateway.client.mutePublishedTrack>>;
  };
  gateway.control = async () => {};
  await gateway.muteMicrophone("room", "user", [
    { sid: "voice", source: TrackSource.MICROPHONE },
    {
      sid: "accompaniment",
      source: TrackSource.MICROPHONE,
      name: "cinegather-accompaniment-v1",
    },
    { sid: "screen", source: TrackSource.SCREEN_SHARE_AUDIO },
  ]);
  expect(muted).toEqual([{ sid: "voice", mute: true }]);
});

test("owner can stop just accompaniment without touching voice/video or granting unmute", async () => {
  const gateway = new MediaGateway();
  const calls: unknown[][] = [];
  const packets: unknown[] = [];
  gateway.client.mutePublishedTrack = async (...args) => {
    calls.push(args);
    return {} as Awaited<ReturnType<typeof gateway.client.mutePublishedTrack>>;
  };
  gateway.control = async (_id, command) => {
    packets.push(command);
  };
  await gateway.stopAccompaniment("room", "member", [
    {
      sid: "music",
      source: TrackSource.MICROPHONE,
      name: "cinegather-accompaniment-v1",
    },
    { sid: "voice", source: TrackSource.MICROPHONE, name: "microphone" },
    { sid: "screen", source: TrackSource.SCREEN_SHARE_AUDIO, name: "影片声音" },
  ]);
  expect(calls).toEqual([["room", "member", "music", true]]);
  expect(packets).toEqual([{ action: "stop-accompaniment", roomId: "room" }]);
  await gateway.stopAccompaniment("room", "member", []);
  expect(packets).toHaveLength(2);
});
