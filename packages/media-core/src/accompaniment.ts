// Accompaniment has no screen lease: only an explicit local share-start stops it.
export class Accompaniment {
  private revision = 0;
  private track?: MediaStreamTrack;
  private level = 0.2;
  active = false;
  constructor(
    private readonly deps: {
      capture(source: string, volume: number): Promise<MediaStreamTrack>;
      stopCapture(): Promise<void>;
      publish(track: MediaStreamTrack): Promise<void>;
      unpublish(track: MediaStreamTrack): Promise<void>;
      volume(value: number): void;
      changed(status: "idle" | "starting" | "active", source?: string): void;
    },
  ) {}
  private async clear() {
    const track = this.track;
    this.track = undefined;
    this.active = false;
    const results = await Promise.allSettled([
      this.deps.stopCapture(),
      ...(track ? [this.deps.unpublish(track)] : []),
    ]);
    track?.stop();
    const failure = results.find((r) => r.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
  }
  async start(source: string) {
    const revision = ++this.revision;
    this.deps.changed("starting", source);
    try {
      await this.clear();
      if (revision !== this.revision) return;
      const track = await this.deps.capture(source, this.level);
      if (revision !== this.revision) {
        track.stop();
        return;
      }
      this.track = track;
      await this.deps.publish(track);
      if (revision !== this.revision) {
        await this.deps.unpublish(track);
        track.stop();
        return;
      }
      this.active = true;
      this.deps.changed("active", source);
    } catch (error) {
      if (revision !== this.revision) return;
      await this.stop();
      throw error;
    }
  }
  volume(value: number) {
    this.level = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
    this.deps.volume(this.level);
  }
  async stop() {
    ++this.revision;
    this.deps.changed("idle");
    await this.clear();
  }
}
