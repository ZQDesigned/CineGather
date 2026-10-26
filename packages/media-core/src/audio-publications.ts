import { Track } from "livekit-client";
import { ACCOMPANIMENT_TRACK } from "@cinegather/contracts";
export { ACCOMPANIMENT_TRACK };
export function isAccompaniment(pub: {
  trackName: string;
  source: Track.Source;
}) {
  return (
    pub.source === Track.Source.Microphone &&
    pub.trackName === ACCOMPANIMENT_TRACK
  );
}
export function voicePublication<
  T extends { source: Track.Source; trackName: string },
>(publications: ReadonlyMap<string, T>): T | undefined {
  return [...publications.values()].find(
    (pub) => pub.source === Track.Source.Microphone && !isAccompaniment(pub),
  );
}
