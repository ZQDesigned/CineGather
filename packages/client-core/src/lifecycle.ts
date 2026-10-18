export class RevisionGate {
  private revision = 0;
  next() { return ++this.revision; }
  isCurrent(revision: number) { return revision === this.revision; }
  invalidate() { this.revision++; }
}
