// User intent survives temporary call interruptions, but a host restriction,
// permission revocation or leaving the room always requires a fresh unmute.
export class MobileMicrophoneIntent {
  private inRoom = false;
  private allowed = true;
  private permission = false;
  private interrupted = false;
  private wanted = false;
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
    this.wanted = wanted && this.allowed && this.inRoom;
  }
  setPermission(granted: boolean) {
    this.permission = granted;
    if (!granted) this.wanted = false;
  }
  setAllowed(allowed: boolean) {
    this.allowed = allowed;
    if (!allowed) this.wanted = false;
  }
  setInterrupted(interrupted: boolean) {
    this.interrupted = interrupted;
  }
  setInRoom(inRoom: boolean) {
    this.inRoom = inRoom;
    if (!inRoom) {
      this.wanted = false;
      this.allowed = true;
      this.interrupted = false;
    }
  }
}
