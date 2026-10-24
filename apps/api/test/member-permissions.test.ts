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
