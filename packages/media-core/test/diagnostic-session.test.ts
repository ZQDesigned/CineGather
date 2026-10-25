import { expect, test } from "bun:test";
import { MediaSession } from "../src/session";
import type { Room } from "livekit-client";

test("a throwing track settings getter and failed sibling stats do not erase healthy RTP evidence", async () => {
  const session = new MediaSession(
    () => {},
    () => {},
    () => {},
  );
  const healthy = {
    trackSid: "TR_video",
    source: "screen_share",
    kind: "video",
    isMuted: false,
    isSubscribed: true,
    track: {
      streamState: "active",
      mediaStreamTrack: {
        getSettings() {
          throw new Error("https://private/settings?token=secret");
        },
      },
      async getRTCStatsReport() {
        return new Map([
          [
            "V",
            {
              id: "V",
              type: "outbound-rtp",
              kind: "video",
              framesEncoded: 300,
              totalEncodeTime: NaN,
              encoderImplementation: "OpenH264",
            },
          ],
        ]);
      },
    },
  };
  const broken = {
    ...healthy,
    trackSid: "TR_broken",
    track: {
      ...healthy.track,
      async getRTCStatsReport() {
        throw new Error("Bearer private");
      },
    },
  };
  // A second participant's unavailable metadata must not reject Promise.all.
  const invalid = {
    ...healthy,
    get trackSid(): string {
      throw new Error("private-track");
    },
  };
  const localParticipant = {
    identity: "raw-user-id",
    trackPublications: new Map([
      ["good", healthy],
      ["bad", broken],
      ["invalid", invalid],
    ]),
  };
  (session as unknown as { room: Room }).room = {
    state: "connected",
    localParticipant,
    remoteParticipants: new Map(),
  } as unknown as Room;
  const sample = await session.detailedDiagnostics();
  expect(sample.tracks).toHaveLength(2);
  expect(sample.tracks[0]).toMatchObject({
    status: "ok",
    stats: [{ framesEncoded: 300, encoderImplementation: "OpenH264" }],
  });
  expect(sample.tracks[1]).toMatchObject({ status: "failed", stats: [] });
  expect(sample.issues).toContainEqual({
    stage: "track",
    code: "read-failed",
    field: "media.tracks.0.settings",
  });
  expect(sample.issues).toContainEqual({
    stage: "rtc",
    code: "invalid-number",
    field: "media.tracks.0.stats.totalEncodeTime",
  });
  expect(sample.issues).toContainEqual({
    stage: "rtc",
    code: "read-failed",
    field: "media.tracks.1.stats",
  });
  expect(sample.issues).toContainEqual({
    stage: "track",
    code: "read-failed",
    field: "media.tracks.2",
  });
  expect(JSON.stringify(sample)).not.toMatch(/private|secret|raw-user-id|NaN/);
  expect(
    (await session.detailedDiagnostics()).tracks[0]?.stats[0]?.framesEncoded,
  ).toBe(300);
});
