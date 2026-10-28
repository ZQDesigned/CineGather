import { z } from "zod";
import {
  clientNotificationSchema,
  notificationRecordSchema,
  type ClientNotification,
  type NotificationPreferences,
  type NotificationRecord,
} from "@cinegather/contracts";

const retention = 7 * 86400_000;
const cacheSchema = z.strictObject({
  items: z.array(notificationRecordSchema).max(100),
  seen: z.array(z.string().min(1).max(200)).max(500),
});

export class NotificationInbox {
  private key?: string;
  private items: NotificationRecord[] = [];
  private seen = new Set<string>();
  constructor(
    private storage: {
      load(key: string): unknown;
      save(key: string, value: unknown): void;
    },
    private changed: (items: NotificationRecord[]) => void,
    private now = () => Date.now(),
  ) {}
  scope(key?: string) {
    if (key === this.key) return;
    this.key = key;
    this.items = [];
    this.seen.clear();
    if (key) {
      try {
        const parsed = cacheSchema.safeParse(this.storage.load(key));
        if (parsed.success) {
          this.items = parsed.data.items;
          this.seen = new Set(parsed.data.seen);
        }
      } catch {
        /* Storage can be unavailable in a private browser session. */
      }
    }
    this.emit();
  }
  snapshot(): NotificationRecord[] {
    const now = this.now();
    this.items = this.items.filter((item) => item.createdAt >= now - retention);
    return this.items.map((item) => ({
      ...item,
      active:
        item.active && (item.expiresAt === undefined || item.expiresAt > now),
    }));
  }
  publish(input: ClientNotification) {
    if (!this.key) return false;
    const parsed = clientNotificationSchema.safeParse(input);
    if (!parsed.success || this.seen.has(parsed.data.eventId)) return false;
    const event = parsed.data;
    this.seen.add(event.eventId);
    while (this.seen.size > 500)
      this.seen.delete(this.seen.values().next().value!);
    const id = event.groupId ?? event.eventId;
    const previous = this.items.find((item) => item.id === id);
    const active =
      event.expiresAt === undefined || event.expiresAt > this.now();
    this.items = [
      {
        ...event,
        id,
        createdAt: this.now(),
        count:
          previous && !previous.read ? Math.min(previous.count + 1, 100000) : 1,
        read: false,
        active,
      },
      ...this.items.filter((item) => item.id !== id),
    ].slice(0, 100);
    this.emit();
    return active;
  }
  read(id?: string) {
    if (!this.items.some((item) => !item.read && (!id || item.id === id)))
      return;
    this.items = this.items.map((item) =>
      !id || item.id === id ? { ...item, read: true } : item,
    );
    this.emit();
  }
  resolve(id: string) {
    if (
      !this.items.some((item) => item.id === id && (item.active || !item.read))
    )
      return;
    this.items = this.items.map((item) =>
      item.id === id ? { ...item, active: false, read: true } : item,
    );
    this.emit();
  }
  clear() {
    this.items = [];
    this.emit();
  }
  private emit() {
    const items = this.snapshot();
    if (this.key) {
      try {
        this.storage.save(this.key, { items, seen: [...this.seen] });
      } catch {
        /* In-memory notifications remain usable when the disk is full. */
      }
    }
    this.changed(items);
  }
}

export function notificationDelivery(
  preferences: NotificationPreferences,
  event: ClientNotification,
  options: {
    background: boolean;
    sharing: boolean;
    now: number;
    lastSound: number;
  },
) {
  const category =
    event.category === "chat" ||
    event.category === "friends" ||
    event.category === "system"
      ? event.category
      : "requests";
  const enabled =
    preferences.enabled && !preferences.doNotDisturb && preferences[category];
  const privateContent = options.sharing || !preferences.preview;
  return {
    desktop: enabled && preferences.desktop && options.background,
    sound:
      enabled &&
      preferences.sound &&
      preferences.volume > 0 &&
      options.now - options.lastSound >= 3000,
    title: privateContent ? "映聚" : event.title,
    body: privateContent
      ? event.category === "chat"
        ? "收到一条新消息"
        : "收到一条新提醒"
      : event.body,
  };
}
