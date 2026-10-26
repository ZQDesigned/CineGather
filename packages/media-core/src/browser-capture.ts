import { qualityPresets, type Quality } from "@cinegather/contracts";

const stop = (stream: MediaStream) =>
  stream.getTracks().forEach((t) => t.stop());

// Owns both pending grants and live capture. A canceled picker can resolve later;
// its tracks must never escape into a newer room or publication.
export class BrowserCapture {
  private revision = 0;
  private stream?: MediaStream;
  private pending?: MediaStream;
  audioNotice = "";
  constructor(
    private readonly capture = (options: DisplayMediaStreamOptions) => {
      if (
        !globalThis.isSecureContext ||
        !navigator.mediaDevices?.getDisplayMedia
      )
        throw new Error(
          "共享画面需要使用 HTTPS 或本机地址，并允许 Chrome 共享屏幕",
        );
      return navigator.mediaDevices.getDisplayMedia(options);
    },
    private readonly canIsolate = () =>
      Boolean(
        (
          navigator.mediaDevices?.getSupportedConstraints() as MediaTrackSupportedConstraints & {
            restrictOwnAudio?: boolean;
          }
        )?.restrictOwnAudio,
      ),
  ) {}
  get current() {
    return this.stream;
  }
  get selected() {
    return this.pending ?? this.stream;
  }
  cancelSelection() {
    ++this.revision;
    if (this.pending) stop(this.pending);
    this.pending = undefined;
  }
  commitSelection() {
    if (!this.pending) return;
    const previous = this.stream;
    this.stream = this.pending;
    this.pending = undefined;
    if (previous) stop(previous);
  }
  async select(
    quality: Quality,
    audio: boolean,
    replacing = false,
  ): Promise<boolean> {
    if (replacing) this.cancelSelection();
    else this.stop();
    const revision = this.revision;
    const preset = qualityPresets[quality];
    const isolate = audio && this.canIsolate();
    // Called directly from the confirmation click, before any await/network IO.
    const stream = await this.capture({
      video: {
        displaySurface: "browser",
        width: { ideal: preset.width },
        height: { ideal: preset.height },
        frameRate: { ideal: preset.frameRate },
      },
      audio: audio
        ? {
            restrictOwnAudio: true,
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            channelCount: 2,
          }
        : false,
      selfBrowserSurface: "exclude",
      surfaceSwitching: "exclude",
      systemAudio: isolate ? "include" : "exclude",
      windowAudio: isolate ? "window" : "exclude",
    } as DisplayMediaStreamOptions);
    if (revision !== this.revision) {
      stop(stream);
      return false;
    }
    const video = stream.getVideoTracks()[0];
    if (!video || video.readyState !== "live") {
      stop(stream);
      throw new Error("未获取到可用画面，请重新选择共享来源");
    }
    this.audioNotice = "";
    const tab = video.getSettings().displaySurface === "browser";
    for (const track of stream.getAudioTracks()) {
      if (
        !audio ||
        (!tab &&
          (
            track.getSettings() as MediaTrackSettings & {
              restrictOwnAudio?: boolean;
            }
          ).restrictOwnAudio !== true)
      ) {
        track.stop();
        stream.removeTrack(track);
        if (audio)
          this.audioNotice =
            "Chrome 未提供声音隔离，当前仅共享画面。可改为共享标签页并开启声音。";
      }
    }
    if (audio && !stream.getAudioTracks().length && !this.audioNotice)
      this.audioNotice =
        "本次 Chrome 未提供共享声音，当前仅共享画面。共享标签页时可在选择器中开启声音。";
    video.contentHint = quality === "game" ? "motion" : "detail";
    if (replacing) this.pending = stream;
    else this.stream = stream;
    return true;
  }
  stop() {
    this.cancelSelection();
    if (this.stream) stop(this.stream);
    this.stream = undefined;
  }
}
