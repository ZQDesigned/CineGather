import { expect, test } from "bun:test";
import { Track } from "livekit-client";
import { nativeIdentity } from "@cinegather/contracts";
import { ShareSubscriptions } from "../src/subscriptions";

function publication(trackSid: string, source: Track.Source) {
  return {
    trackSid,
    source,
    isDesired: false,
    setSubscribed(value: boolean) {
      this.isDesired = value;
    },
  };
}
function participant(
  identity: string,
  ...tracks: ReturnType<typeof publication>[]
) {
  return {
    identity,
    trackPublications: new Map(tracks.map((t) => [t.trackSid, t])),
  };
}
function fixture() {
  const voice = publication("mic", Track.Source.Microphone),
    video = publication("screen", Track.Source.ScreenShare),
    audio = publication("film", Track.Source.ScreenShareAudio);
  const other = participant("other", voice, video, audio);
  const room = {
    localParticipant: { identity: "self" },
    remoteParticipants: new Map([[other.identity, other]]),
  };
  return { voice, video, audio, other, room, policy: new ShareSubscriptions() };
}
test("room voice subscribes immediately while existing and later screen audio/video require explicit viewing", () => {
  const f = fixture();
  f.other.trackPublications.delete("film");
  f.policy.sync(f.room);
  expect([f.voice.isDesired, f.video.isDesired]).toEqual([true, false]);
  expect(f.policy.watching).toBe(false);
  f.policy.watch(true);
  f.policy.sync(f.room);
  f.other.trackPublications.set("film", f.audio);
  f.policy.sync(f.room);
  expect([f.voice.isDesired, f.video.isDesired, f.audio.isDesired]).toEqual([
    true,
    true,
    true,
  ]);
  f.policy.watch(false);
  f.policy.sync(f.room);
  expect([f.voice.isDesired, f.video.isDesired, f.audio.isDesired]).toEqual([
    true,
    false,
    false,
  ]);
});
test("audio published before video does not leak and restarting or replacing a share clears viewing consent", () => {
  const f = fixture();
  f.other.trackPublications.delete("screen");
  f.policy.sync(f.room);
  f.policy.watch(true);
  f.policy.sync(f.room);
  expect(f.audio.isDesired).toBe(false);
  f.other.trackPublications.set("screen", f.video);
  f.policy.sync(f.room);
  f.policy.watch(true);
  f.policy.sync(f.room);
  expect(f.audio.isDesired).toBe(true);
  f.other.trackPublications.delete("screen");
  f.policy.sync(f.room);
  expect([f.policy.watching, f.audio.isDesired]).toEqual([false, false]);
  const replacement = publication("new-screen", Track.Source.ScreenShare);
  f.other.trackPublications.set(replacement.trackSid, replacement);
  f.policy.sync(f.room);
  expect([f.policy.watching, replacement.isDesired, f.audio.isDesired]).toEqual(
    [false, false, false],
  );
  f.policy.watch(true);
  f.policy.sync(f.room);
  f.other.trackPublications.clear();
  const next = participant(
    "next",
    publication("next-video", Track.Source.ScreenShare),
  );
  f.room.remoteParticipants.set(next.identity, next);
  f.policy.sync(f.room);
  expect(f.policy.watching).toBe(false);
  expect(next.trackPublications.get("next-video")!.isDesired).toBe(false);
});
test("local native capture never loops shared audio or video back to its owner", () => {
  const f = fixture();
  f.room.localParticipant.identity = "00000000-0000-4000-8000-000000000001";
  f.other.identity = nativeIdentity(
    f.room.localParticipant.identity,
    "00000000-0000-4000-8000-000000000002",
  );
  f.policy.sync(f.room);
  f.policy.watch(true);
  f.policy.sync(f.room);
  expect([f.policy.watching, f.video.isDesired, f.audio.isDesired]).toEqual([
    false,
    false,
    false,
  ]);
});
test("disconnect resets viewing selection before the same publication is seen again", () => {
  const f = fixture();
  f.policy.sync(f.room);
  f.policy.watch(true);
  f.policy.sync(f.room);
  expect(f.video.isDesired).toBe(true);
  f.policy.reset();
  f.policy.sync(f.room);
  expect([f.policy.watching, f.video.isDesired, f.audio.isDesired]).toEqual([
    false,
    false,
    false,
  ]);
});
