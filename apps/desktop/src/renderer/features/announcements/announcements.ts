import {
  announcementFeedSchema,
  announcementInboxSchema,
  type Announcement,
  type ClientNotification,
} from "@cinegather/contracts";
export function announcementActive(a: Announcement, now = Date.now()) {
  return (
    a.state === "active" &&
    !!a.publishedAt &&
    !!a.startsAt &&
    !!a.expiresAt &&
    Date.parse(a.startsAt) <= now &&
    Date.parse(a.expiresAt) > now
  );
}
export interface AnnouncementSnapshot {
  items: Announcement[];
  readIds: string[];
  offset: number;
}
interface Dependencies {
  load(signedIn: boolean): Promise<unknown>;
  receive(ids: string[]): Promise<{ remindIds: string[] }>;
  read(ids: string[]): Promise<unknown>;
  changed(snapshot: AnnouncementSnapshot): void;
  notices(items: Announcement[], fresh: string[], read: string[]): void;
}
export class AnnouncementClient {
  private user?: string;
  private begun = false;
  private revision = 0;
  private busy?: Promise<void>;
  private again = false;
  private snapshot: AnnouncementSnapshot = {
    items: [],
    readIds: [],
    offset: 0,
  };
  constructor(
    private dependencies: Dependencies,
    private storage?: { load(): unknown; save(value: unknown): void },
    private now = () => Date.now(),
  ) {
    try {
      const raw = this.storage?.load() as
        | { feed?: unknown; offset?: unknown }
        | undefined;
      const parsed = announcementFeedSchema.safeParse(raw?.feed);
      if (parsed.success) {
        this.snapshot.items = this.publicItems(parsed.data.items);
        this.snapshot.offset =
          typeof raw?.offset === "number" && Number.isFinite(raw.offset)
            ? raw.offset
            : 0;
      }
    } catch {
      /* The public cache is optional. */
    }
  }
  private publicItems(items: Announcement[]) {
    return items.filter(
      (a) => a.publishedAt && ["active", "expired"].includes(a.state),
    );
  }
  scope(user?: string) {
    if (this.begun && user === this.user) return this.busy ?? Promise.resolve();
    this.begun = true;
    this.user = user;
    ++this.revision;
    this.snapshot.readIds = [];
    this.dependencies.changed({ ...this.snapshot });
    return this.refresh();
  }
  refresh(): Promise<void> {
    if (this.busy) {
      this.again = true;
      return this.busy;
    }
    const revision = this.revision,
      user = this.user,
      start = this.now(),
      active = () => revision === this.revision;
    const work = (async () => {
      try {
        const raw = await this.dependencies.load(!!user);
        if (!active()) return;
        const feed = user
          ? announcementInboxSchema.parse(raw)
          : announcementFeedSchema.parse(raw);
        const items = this.publicItems(feed.items);
        const offset = Date.parse(feed.serverTime) - (start + this.now()) / 2;
        const received = new Set(
          user
            ? announcementInboxSchema
                .parse(feed)
                .items.filter((a) => a.received)
                .map((a) => a.id)
            : [],
        );
        const readIds = user
          ? announcementInboxSchema
              .parse(feed)
              .items.filter((a) => a.read)
              .map((a) => a.id)
          : [];
        this.snapshot = { items, offset, readIds };
        this.dependencies.changed({ ...this.snapshot });
        try {
          this.storage?.save({
            feed: { serverTime: feed.serverTime, items },
            offset,
          });
        } catch {
          /* Keep the live announcement when storage is unavailable. */
        }
        if (!user || !active()) return;
        const unseen = items
          .filter(
            (a) =>
              announcementActive(a, this.now() + offset) &&
              !received.has(a.id) &&
              !readIds.includes(a.id),
          )
          .map((a) => a.id);
        const claimed = unseen.length
          ? await this.dependencies.receive(unseen)
          : { remindIds: [] };
        if (!active()) return;
        this.dependencies.notices(
          items,
          claimed.remindIds.filter((id) =>
            items.some(
              (a) => a.id === id && announcementActive(a, this.now() + offset),
            ),
          ),
          readIds,
        );
      } catch {
        /* Keep known maintenance information while offline; refresh on reconnect/focus. */
      }
    })();
    this.busy = work;
    void work.finally(() => {
      if (this.busy === work) this.busy = undefined;
      if (this.again) {
        this.again = false;
        void this.refresh();
      }
    });
    return work;
  }
  async read(ids: string[]) {
    const revision = this.revision;
    if (!this.user || !ids.length) return;
    await this.dependencies.read(ids);
    if (revision !== this.revision) return;
    this.snapshot.readIds = [...new Set([...this.snapshot.readIds, ...ids])];
    this.dependencies.changed({ ...this.snapshot });
  }
  stop() {
    ++this.revision;
    this.again = false;
    this.user = undefined;
    this.begun = false;
  }
}

export function announcementNotification(
  a: Announcement,
  offset = 0,
): ClientNotification {
  return {
    eventId: "announcement:" + a.id,
    category: "system",
    title: a.title,
    body: a.body.slice(0, 300),
    target: "announcements",
    entityId: a.id,
    expiresAt: a.expiresAt ? Date.parse(a.expiresAt) - offset : undefined,
  };
}
