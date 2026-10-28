import { watchProfiles, type WatchProfile } from "@cinegather/contracts";
interface BufferReceiver {
  jitterBufferTarget?: number | null;
  playoutDelayHint?: number;
}
interface BufferedTrack {
  isLocal: boolean;
  receiver?: BufferReceiver;
}
export class WatchPlaybackPolicy {
  profile: WatchProfile = "balanced";
  private applied = new WeakMap<
    BufferReceiver,
    {
      target: number;
      supported: boolean;
      field?: keyof BufferReceiver;
      owner: BufferedTrack;
    }
  >();
  apply(...tracks: (BufferedTrack | undefined)[]) {
    let count = 0,
      supported = true;
    for (const track of tracks) {
      if (!track || track.isLocal || !track.receiver) continue;
      ++count;
      const receiver = track.receiver,
        target = watchProfiles[this.profile].targetMs;
      let result = this.applied.get(receiver);
      let retained = false;
      try {
        retained = Boolean(
          result?.field &&
            receiver[result.field] ===
              (result.field === "jitterBufferTarget" ? target : target / 1000),
        );
      } catch {
        /* Some engines expose a receiver property before it is usable. */
      }
      if (
        result?.target !== target ||
        result.owner !== track ||
        (result.supported && !retained)
      ) {
        result = { target, supported: false, owner: track };
        for (const field of [
          "jitterBufferTarget",
          "playoutDelayHint",
        ] as const) {
          try {
            if (field in receiver) {
              const value =
                field === "jitterBufferTarget" ? target : target / 1000;
              receiver[field] = value;
              if (receiver[field] === value) {
                result.supported = true;
                result.field = field;
                break;
              }
            }
          } catch {
            /* Try the older API when an engine exposes an unusable new setter. */
          }
        }
        this.applied.set(receiver, result);
      }
      supported &&= result!.supported;
    }
    return count ? supported : undefined;
  }
}

export type WatchAdvice = "network" | "network-persistent";
export class WatchHealth {
  reset() {
    this.track = this.profile = this.advice = undefined;
    this.last = this.badSince = this.goodSince = undefined;
  }
  private track?: string;
  private profile?: WatchProfile;
  private last?: number;
  private badSince?: number;
  private goodSince?: number;
  private advice?: WatchAdvice;
  sample(input: {
    track?: string;
    at: number;
    watching: boolean;
    visible: boolean;
    profile: WatchProfile;
    jitter?: number;
    frameAgeMs?: number;
    maxFrameGapMs?: number;
  }) {
    const reset =
      !input.watching ||
      !input.visible ||
      !input.track ||
      this.track !== input.track ||
      this.profile !== input.profile ||
      (this.last !== undefined &&
        (input.at - this.last > 6500 || input.at < this.last));
    if (reset) {
      this.badSince = this.goodSince = this.advice = undefined;
    }
    this.track = input.track;
    this.profile = input.profile;
    this.last = input.at;
    if (!input.watching || !input.visible || !input.track) return undefined;
    const stalled =
      (input.frameAgeMs ?? 0) > 750 || (input.maxFrameGapMs ?? 0) > 750;
    const bad = stalled && (input.jitter ?? 0) >= 0.04;
    if (bad) {
      this.goodSince = undefined;
      this.badSince ??= input.at;
      if (input.at - this.badSince >= 6000)
        this.advice =
          input.profile === "smooth" ? "network-persistent" : "network";
    } else {
      this.badSince = undefined;
      this.goodSince ??= input.at;
      if (input.at - this.goodSince >= 4000) this.advice = undefined;
    }
    return this.advice;
  }
}
