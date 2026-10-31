// User intent survives temporary call interruptions, but a host restriction,
// permission revocation or leaving the room always requires a fresh unmute.
export class MobileMicrophoneIntent {
  private inRoom = false;
  private allowed = true;
  private permission = false;
  private interrupted = false;
  private wanted = false;
  private revision = 0;
  beginUnmute() {
    if (!this.inRoom || !this.allowed) return;
    this.interrupted = false;
    return ++this.revision;
  }
  completeUnmute(request: number, granted: boolean) {
    if (
      request !== this.revision ||
      !this.inRoom ||
      !this.allowed ||
      this.interrupted
    )
      return false;
    this.setPermission(granted);
    this.wanted = granted;
    return this.enabled;
  }
  get enabled() {
    return (
      this.inRoom &&
      this.allowed &&
      this.permission &&
      !this.interrupted &&
      this.wanted
    );
  }
  get requested() {
    return this.wanted;
  }
  setWanted(wanted: boolean) {
    if (!wanted) ++this.revision;
    this.wanted = wanted && this.allowed && this.inRoom;
  }
  setPermission(granted: boolean) {
    this.permission = granted;
    if (!granted) {
      ++this.revision;
      this.wanted = false;
    }
  }
  setAllowed(allowed: boolean) {
    this.allowed = allowed;
    if (!allowed) {
      ++this.revision;
      this.wanted = false;
    }
  }
  setInterrupted(interrupted: boolean) {
    if (interrupted) ++this.revision;
    this.interrupted = interrupted;
  }
  setInRoom(inRoom: boolean) {
    this.inRoom = inRoom;
    if (!inRoom) {
      ++this.revision;
      this.wanted = false;
      this.allowed = true;
      this.interrupted = false;
    }
  }
}
