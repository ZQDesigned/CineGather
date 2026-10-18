export interface AudioSink {
  setVolume(volume: number): void;
}
export class AudioMixer {
  private tracks = new Map<
    string,
    { userId: string; kind: "voice" | "screen"; sink: AudioSink }
  >();
  private voiceVolume = 1;
  private screenVolume = 1;
  private members = new Map<string, number>();
  attach(
    id: string,
    userId: string,
    kind: "voice" | "screen",
    sink: AudioSink,
  ) {
    this.tracks.set(id, { userId, kind, sink });
    this.apply();
  }
  remove(id: string) {
    this.tracks.delete(id);
  }
  clear() {
    this.tracks.clear();
  }
  voice(volume: number) {
    this.voiceVolume = this.clamp(volume);
    this.apply();
  }
  screen(volume: number) {
    this.screenVolume = this.clamp(volume);
    this.apply();
  }
  member(userId: string, volume: number) {
    this.members.set(userId, this.clamp(volume));
    this.apply();
  }
  private clamp(value: number) {
    return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
  }
  private apply() {
    for (const { userId, kind, sink } of this.tracks.values())
      sink.setVolume(
        kind === "screen"
          ? this.screenVolume
          : this.voiceVolume * (this.members.get(userId) ?? 1),
      );
  }
}
