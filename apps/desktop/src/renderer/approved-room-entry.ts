import { z } from "zod";
import type { RoomInvitation } from "@cinegather/contracts";

const intentSchema = z.object({
  owner: z.string(),
  id: z.uuid(),
  expiresAt: z.iso.datetime({ offset: true }),
});
interface EntryDependencies {
  identity(): string | undefined;
  ready(): boolean;
  load(): string | null;
  save(value: string | null): void;
  join(invitation: RoomInvitation): Promise<void>;
  error(error: unknown): void;
}

// Only the window which applied may automatically join. A newer application
// replaces older intent; receiving an ordinary invitation never grants consent.
export class ApprovedRoomEntry {
  private pending?: z.infer<typeof intentSchema>;
  private joining = false;
  private revision = 0;
  constructor(private readonly deps: EntryDependencies) {
    try {
      this.pending = intentSchema.parse(JSON.parse(deps.load() ?? "null"));
    } catch {
      // Storage may be unavailable or contain expired/corrupt prior state.
    }
  }
  private persist() {
    try {
      this.deps.save(this.pending ? JSON.stringify(this.pending) : null);
    } catch {
      // The current window can still use its in-memory intent.
    }
  }
  remember(request: { id: string; expiresAt: string }) {
    const owner = this.deps.identity();
    if (!owner) return;
    const pending = intentSchema.parse({ owner, ...request });
    // An approval issued just before the request expires grants a fresh
    // five-minute invitation. Preserve intent long enough to receive it.
    this.pending = {
      ...pending,
      expiresAt: new Date(
        Date.parse(pending.expiresAt) + 5 * 60_000,
      ).toISOString(),
    };
    this.persist();
  }
  clear() {
    ++this.revision;
    this.pending = undefined;
    this.persist();
  }
  async sync(invitations: RoomInvitation[]) {
    const identity = this.deps.identity();
    const pending = this.pending;
    if (this.joining || !identity || !pending || pending.owner !== identity)
      return;
    if (Date.parse(pending.expiresAt) <= Date.now()) {
      this.clear();
      return;
    }
    if (!this.deps.ready()) return;
    const invitation = invitations.find(
      (invite) =>
        invite.requestApproved &&
        invite.requestId === pending.id &&
        Date.parse(invite.expiresAt) > Date.now(),
    );
    if (!invitation) return;
    const revision = this.revision;
    // Consume before entering, including before any nested social refresh.
    // Failed entry remains recoverable through the normal invitation inbox.
    this.pending = undefined;
    this.persist();
    this.joining = true;
    try {
      await this.deps.join(invitation);
    } catch (error) {
      if (identity === this.deps.identity() && revision === this.revision)
        this.deps.error(error);
    } finally {
      this.joining = false;
    }
  }
}
