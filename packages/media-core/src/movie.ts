import type { Track, RemoteAudioTrack } from "livekit-client";
// A single HTML media clock presents the film's audio/video together. Voice
// stays on independent elements and the movie never receives local film audio.
export class MoviePlayback {
  private element?: HTMLVideoElement;
  private video?: Track;
  private audio?: RemoteAudioTrack;
  bind(element?: HTMLVideoElement) {
    if (this.element === element) return;
    if (this.element) {
      this.video?.detach(this.element);
      this.audio?.detach(this.element);
    }
    this.element = element;
    this.attach();
  }
  tracks(video?: Track, audio?: RemoteAudioTrack) {
    if (this.element) {
      if (this.video !== video) this.video?.detach(this.element);
      if (this.audio !== audio) this.audio?.detach(this.element);
    }
    this.video = video;
    this.audio = audio;
    this.attach();
  }
  private attach() {
    const element = this.element;
    if (!element) return;
    this.video?.attach(element);
    this.audio?.attach(element);
    element.muted = !this.audio;
    void element.play().catch(() => {});
  }
}
