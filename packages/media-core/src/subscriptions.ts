import { Track } from "livekit-client";
import { nativeOwner } from "@cinegather/contracts";

interface Publication {
  trackSid: string;
  source: Track.Source;
  isDesired: boolean;
  setSubscribed(value: boolean): void;
}
interface SubscriptionRoom {
  localParticipant: { identity: string };
  remoteParticipants: ReadonlyMap<
    string,
    {
      identity: string;
      trackPublications: ReadonlyMap<string, Publication>;
    }
  >;
}

// Consent belongs to one screen publication, never to future shares or rooms.
export class ShareSubscriptions {
  private screenId?: string;
  watching = false;
  sync(room: SubscriptionRoom) {
    const participants = [...room.remoteParticipants.values()];
    const sharer = participants.find((p) =>
      [...p.trackPublications.values()].some(
        (t) => t.source === Track.Source.ScreenShare,
      ),
    );
    const screen =
      sharer && nativeOwner(sharer.identity) !== room.localParticipant.identity
        ? [...sharer.trackPublications.values()].find(
            (t) => t.source === Track.Source.ScreenShare,
          )
        : undefined;
    if (screen?.trackSid !== this.screenId) {
      this.screenId = screen?.trackSid;
      this.watching = false;
    }
    for (const p of participants) {
      for (const pub of p.trackPublications.values()) {
        const shared =
          pub.source === Track.Source.ScreenShare ||
          pub.source === Track.Source.ScreenShareAudio;
        const desired = shared ? this.watching && p === sharer : true;
        if (pub.isDesired !== desired) pub.setSubscribed(desired);
      }
    }
  }
  watch(enabled: boolean) {
    this.watching = enabled && Boolean(this.screenId);
  }
  reset() {
    this.screenId = undefined;
    this.watching = false;
  }
}
