import type { NativePreviewBridge } from "@cinegather/contracts";

export type PreviewStatus = "paused" | "loading" | "playing" | "unavailable";
type Session = {
  id: string;
  peer: RTCPeerConnection;
  abort: AbortController;
  stream?: MediaStream;
  timer?: ReturnType<typeof setTimeout>;
};

// Receives the original encoded video over loopback. Closing a preview releases
// both the decoder and the native mirror, without touching the publication.
export class NativePreviewPlayer {
  private session?: Session;
  private active = false;
  private retry?: ReturnType<typeof setTimeout>;
  private failures = 0;
  constructor(
    private readonly video: HTMLVideoElement,
    private readonly bridge: Pick<
      NativePreviewBridge,
      "start" | "answer" | "stop"
    >,
    private readonly changed: (status: PreviewStatus) => void,
  ) {}
  private setStatus(status: PreviewStatus) {
    this.changed(status);
  }
  setActive(active: boolean) {
    if (this.active === active) return;
    this.active = active;
    this.failures = 0;
    clearTimeout(this.retry);
    this.close();
    if (active) void this.connect();
    else this.setStatus("paused");
  }
  private close() {
    const session = this.session;
    this.session = undefined;
    if (!session) return;
    session.abort.abort();
    clearTimeout(session.timer);
    session.peer.ontrack = null;
    session.peer.onconnectionstatechange = null;
    session.peer.close();
    session.stream?.getTracks().forEach((track) => track.stop());
    if (this.video.srcObject === session.stream) {
      this.video.pause();
      this.video.srcObject = null;
    }
    void this.bridge.stop(session.id).catch(() => {});
  }
  private fail(session: Session) {
    if (this.session !== session) return;
    this.close();
    this.setStatus("unavailable");
    if (this.active && ++this.failures < 3)
      this.retry = setTimeout(() => void this.connect(), 1000);
  }
  private async connect() {
    if (!this.active) return;
    let peer: RTCPeerConnection;
    try {
      peer = new RTCPeerConnection({
        iceServers: [],
        bundlePolicy: "max-bundle",
      });
    } catch {
      this.setStatus("unavailable");
      return;
    }
    const session: Session = {
      id: crypto.randomUUID(),
      peer,
      abort: new AbortController(),
    };
    this.session = session;
    this.setStatus("loading");
    const current = () => this.active && this.session === session;
    session.timer = setTimeout(() => this.fail(session), 10_000);
    this.video.addEventListener("error", () => this.fail(session), {
      signal: session.abort.signal,
    });
    this.video.addEventListener(
      "loadeddata",
      () => {
        if (
          !current() ||
          this.video.srcObject !== session.stream ||
          this.video.readyState < 2
        )
          return;
        clearTimeout(session.timer);
        this.failures = 0;
        this.setStatus("playing");
      },
      { signal: session.abort.signal },
    );
    session.peer.ontrack = (event) => {
      if (!current() || event.track.kind !== "video") {
        event.track.stop();
        return;
      }
      session.stream = new MediaStream([event.track]);
      this.video.muted = true;
      this.video.srcObject = session.stream;
      void this.video.play().catch(() => this.fail(session));
    };
    session.peer.onconnectionstatechange = () => {
      if (
        ["failed", "closed", "disconnected"].includes(
          session.peer.connectionState,
        )
      )
        this.fail(session);
    };
    try {
      const offer = await this.bridge.start(session.id);
      if (!current()) return;
      if (!offer || offer.id !== session.id)
        throw new Error("preview-unavailable");
      await session.peer.setRemoteDescription({
        type: "offer",
        sdp: offer.sdp,
      });
      if (!current()) return;
      const answer = await session.peer.createAnswer();
      // Same tested DTLS roles as the WHIP decoder smoke test. OBS offers
      // actpass; a passive Chromium answer avoids its large ClientHello being
      // fragmented by the pinned MbedTLS server implementation.
      answer.sdp = answer.sdp!.replaceAll("a=setup:active", "a=setup:passive");
      await session.peer.setLocalDescription(answer);
      await new Promise<void>((resolve) => {
        if (
          session.peer.iceGatheringState === "complete" ||
          session.abort.signal.aborted
        )
          return resolve();
        const finish = () => {
          clearTimeout(timer);
          session.peer.removeEventListener("icegatheringstatechange", gathered);
          session.abort.signal.removeEventListener("abort", finish);
          resolve();
        };
        const gathered = () => {
          if (session.peer.iceGatheringState === "complete") finish();
        };
        const timer = setTimeout(finish, 1500);
        session.peer.addEventListener("icegatheringstatechange", gathered);
        session.abort.signal.addEventListener("abort", finish, { once: true });
      });
      if (!current()) return;
      if (
        !(await this.bridge.answer(
          session.id,
          session.peer.localDescription!.sdp,
        ))
      )
        throw new Error("preview-inactive");
    } catch {
      if (current()) this.fail(session);
    }
  }
  dispose() {
    this.active = false;
    clearTimeout(this.retry);
    this.close();
  }
}
