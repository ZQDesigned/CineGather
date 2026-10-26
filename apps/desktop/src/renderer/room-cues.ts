export type RoomCue = "enter" | "leave";
type Presence = {
  state: string;
  participants: { id: string; local: boolean }[];
};
export class RoomPresenceCues {
  private active = false;
  private baseline?: Set<string>;
  private lastRemote = -Infinity;
  constructor(
    private readonly play: (cue: RoomCue) => void,
    private readonly now = () => Date.now(),
  ) {}
  enter(summary: Presence) {
    this.active = true;
    this.baseline = this.members(summary);
    this.lastRemote = -Infinity;
    this.play("enter");
  }
  observe(summary: Presence) {
    if (!this.active) return;
    if (summary.state !== "connected") {
      this.baseline = undefined;
      return;
    }
    const next = this.members(summary),
      previous = this.baseline;
    this.baseline = next;
    if (!previous) return;
    const entered = [...next].some((id) => !previous.has(id));
    const left = [...previous].some((id) => !next.has(id));
    const now = this.now();
    // Drop bursts rather than queueing stale sounds after a group has entered.
    if ((!entered && !left) || now - this.lastRemote < 700) return;
    this.lastRemote = now;
    this.play(entered ? "enter" : "leave");
  }
  leave() {
    const active = this.active;
    this.reset();
    if (active) this.play("leave");
  }
  reset() {
    this.active = false;
    this.baseline = undefined;
  }
  private members(summary: Presence) {
    return new Set(
      summary.participants.filter((p) => !p.local).map((p) => p.id),
    );
  }
}

export class RoomCuePlayer {
  private audio?: HTMLAudioElement;
  private revision = 0;
  constructor(
    private readonly sources: Record<RoomCue, string>,
    private readonly preferences: () => {
      roomSounds?: boolean;
      outputDevice: string;
    },
    private readonly createAudio = () => new Audio(),
  ) {}
  play(cue: RoomCue) {
    const revision = ++this.revision;
    this.audio?.pause();
    const preferences = this.preferences();
    if (preferences.roomSounds === false) return;
    const audio = (this.audio ??= this.createAudio());
    audio.src = this.sources[cue];
    // Loudness and soft attack are baked into the original sound assets.
    audio.volume = 1;
    void (async () => {
      if (typeof audio.setSinkId === "function") {
        try {
          await audio.setSinkId(preferences.outputDevice);
        } catch {
          // An unplugged device should not route the notification to speakers.
          return;
        }
      }
      if (revision === this.revision) await audio.play();
    })().catch(() => {
      // Browsers may block audio before the first gesture. Never replay it later.
    });
  }
  stop() {
    ++this.revision;
    this.audio?.pause();
  }
}
