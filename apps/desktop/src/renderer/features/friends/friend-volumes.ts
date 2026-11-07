type Friend = { userId: string; status: string; volume?: number };
const bounded = (value: number) =>
  Number.isFinite(value) ? Math.round(Math.max(0, Math.min(200, value))) : 0;
export class FriendVolumes {
  private owner?: string;
  private epoch = 0;
  private revision = 0;
  private friends = new Set<string>();
  private levels = new Map<string, number>();
  private edits = new Map<string, { value: number; revision: number }>();
  private writes = new Map<string, Promise<void>>();
  constructor(
    private readonly save: (
      id: string,
      volume: number,
      owner: string,
    ) => Promise<void>,
    private readonly changed: (
      levels: Record<string, number>,
      reset: boolean,
    ) => void,
  ) {}
  sync(owner: string | undefined, friends: Friend[]) {
    const reset = owner !== this.owner;
    let changed = reset;
    if (reset) {
      ++this.epoch;
      this.owner = owner;
      this.levels.clear();
      this.edits.clear();
      this.writes.clear();
      this.friends.clear();
    }
    if (!owner) {
      if (changed) this.emit(true);
      return;
    }
    const accepted = friends.filter((f) => f.status === "accepted");
    const next = new Set(accepted.map((f) => f.userId));
    for (const id of this.friends) if (!next.has(id)) this.edits.delete(id);
    this.friends = next;
    for (const f of accepted) {
      if (this.edits.has(f.userId)) continue;
      const value = bounded(f.volume ?? 100);
      if (this.levels.get(f.userId) !== value) {
        this.levels.set(f.userId, value);
        changed = true;
      }
    }
    if (changed) this.emit(reset);
  }
  change(id: string, volume: number) {
    const value = bounded(volume);
    if (this.levels.get(id) === value) return;
    this.levels.set(id, value);
    if (this.owner && this.friends.has(id))
      this.edits.set(id, { value, revision: ++this.revision });
    this.emit(false);
  }
  commit(id: string, volume: number): Promise<void> {
    this.change(id, volume);
    const edit = this.edits.get(id),
      owner = this.owner,
      epoch = this.epoch;
    if (!edit || !owner || !this.friends.has(id)) return Promise.resolve();
    const active = () =>
      this.epoch === epoch && this.owner === owner && this.friends.has(id);
    const current = () =>
      active() && this.edits.get(id)?.revision === edit.revision;
    const work = (this.writes.get(id) ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        if (!current()) return;
        try {
          await this.save(id, edit.value, owner);
          if (current()) this.edits.delete(id);
        } catch (error) {
          if (current()) throw error;
        }
      });
    this.writes.set(id, work);
    void work
      .finally(() => {
        if (this.writes.get(id) === work) this.writes.delete(id);
      })
      .catch(() => {});
    return work;
  }
  private emit(reset: boolean) {
    this.changed(Object.fromEntries(this.levels), reset);
  }
}
