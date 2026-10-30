import { and, eq, inArray, lte, gt, gte, or, desc, sql } from "drizzle-orm";
import { announcements, announcementReceipts } from "@cinegather/database";
import type {
  Announcement,
  AnnouncementInput,
  AdminQuery,
  User,
} from "@cinegather/contracts";
import { db, audit, dedup } from "./context";
import { requireManagement } from "./access";
import { fail, uuid } from "./errors";
const day = 86400_000,
  announcementLock = 839216;
const listeners = new Set<() => void>();
export function subscribeAnnouncements(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function changed() {
  for (const listener of listeners)
    try {
      listener();
    } catch {
      /* Reminder delivery must not roll back a committed announcement. */
    }
}
type Row = typeof announcements.$inferSelect;
function present(row: Row, now = Date.now()): Announcement {
  const state =
    row.status === "withdrawn"
      ? "withdrawn"
      : row.status === "draft"
        ? "draft"
        : row.expiresAt && row.expiresAt.getTime() <= now
          ? "expired"
          : row.status === "scheduled"
            ? "scheduled"
            : "active";
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    kind: row.kind as Announcement["kind"],
    popup: row.popup,
    state,
    startsAt: row.startsAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
function times(
  input: Pick<AnnouncementInput, "startsAt" | "expiresAt">,
  publishing = false,
) {
  const now = Date.now(),
    startsAt = input.startsAt ? new Date(input.startsAt) : null,
    expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
  const effective = startsAt?.getTime() ?? now;
  if (
    startsAt &&
    (startsAt.getTime() > now + 90 * day ||
      (publishing && startsAt.getTime() < now))
  )
    fail(
      400,
      "INVALID_ANNOUNCEMENT_TIME",
      "发送时间应在未来 90 天内，立即发布请取消定时发送",
    );
  if (
    expiresAt &&
    (expiresAt.getTime() <= Math.max(effective, now) ||
      expiresAt.getTime() > effective + 30 * day)
  )
    fail(
      400,
      "INVALID_ANNOUNCEMENT_TIME",
      "结束时间应晚于发送时间，且间隔不超过 30 天",
    );
  return { startsAt, expiresAt };
}
export async function listAdminAnnouncements(query: AdminQuery) {
  const where = query.q
    ? sql`${announcements.title} ILIKE ${"%" + query.q.replace(/[\\%_]/g, "\\$&") + "%"}`
    : undefined;
  const [items, [total]] = await Promise.all([
    db
      .select()
      .from(announcements)
      .where(where)
      .orderBy(desc(announcements.createdAt), announcements.id)
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    db
      .select({ value: sql<number>`count(*)`.mapWith(Number) })
      .from(announcements)
      .where(where),
  ]);
  return { items: items.map((r) => present(r)), total: total!.value };
}
export async function saveAnnouncement(
  actor: User,
  input: AnnouncementInput,
  id?: string,
  key?: string,
) {
  const dates = times(input);
  return db.transaction(async (tx) => {
    await requireManagement(tx, actor.id, "announcements.manage");
    return dedup(
      tx,
      actor.id,
      key,
      id ? "announcement-edit" : "announcement-create",
      { ...input, id },
      async () => {
        const now = new Date();
        let row: Row;
        if (id) {
          const [old] = await tx
            .select()
            .from(announcements)
            .where(eq(announcements.id, uuid(id)))
            .for("update");
          if (!old) fail(404, "ANNOUNCEMENT_NOT_FOUND", "公告不存在");
          if (old.status !== "draft")
            fail(
              409,
              "ANNOUNCEMENT_IMMUTABLE",
              "只能编辑草稿；已安排或已发布的公告请撤回后新建",
            );
          [row] = (await tx
            .update(announcements)
            .set({ ...input, ...dates, updatedAt: now })
            .where(eq(announcements.id, old.id))
            .returning()) as [Row];
        } else
          [row] = (await tx
            .insert(announcements)
            .values({
              ...input,
              ...dates,
              id: crypto.randomUUID(),
              createdBy: actor.id,
              createdAt: now,
              updatedAt: now,
            })
            .returning()) as [Row];
        await audit(
          tx,
          actor.id,
          id ? "admin.announcement_edit" : "admin.announcement_create",
          row.id,
          {
            targetName: row.title,
            reason: id ? "编辑公告草稿" : "创建公告草稿",
          },
        );
        return present(row);
      },
    );
  });
}
export async function publishAnnouncement(actor: User, id: string) {
  const result = await db.transaction(async (tx) => {
    await requireManagement(tx, actor.id, "announcements.manage");
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${announcementLock})`);
    const [old] = await tx
      .select()
      .from(announcements)
      .where(eq(announcements.id, uuid(id)))
      .for("update");
    if (!old) fail(404, "ANNOUNCEMENT_NOT_FOUND", "公告不存在");
    if (old.status === "published" || old.status === "scheduled")
      return present(old);
    if (old.status !== "draft")
      fail(409, "ANNOUNCEMENT_WITHDRAWN", "公告已撤回，请新建公告");
    const now = new Date(),
      dates = times(
        {
          startsAt: old.startsAt?.toISOString() ?? null,
          expiresAt: old.expiresAt?.toISOString() ?? null,
        },
        true,
      ),
      start = dates.startsAt ?? now,
      end = dates.expiresAt ?? new Date(start.getTime() + 7 * day);
    const [total] = await tx
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(announcements)
      .where(
        and(
          inArray(announcements.status, ["scheduled", "published"]),
          gt(announcements.expiresAt, now),
        ),
      );
    if (total!.count >= 100)
      fail(
        409,
        "ANNOUNCEMENT_LIMIT",
        "当前生效或待发送的公告较多，请先结束部分公告",
      );
    const scheduled = start.getTime() > now.getTime();
    const [row] = await tx
      .update(announcements)
      .set({
        startsAt: start,
        expiresAt: end,
        publishedAt: scheduled ? null : now,
        status: scheduled ? "scheduled" : "published",
        updatedAt: now,
      })
      .where(eq(announcements.id, old.id))
      .returning();
    await audit(tx, actor.id, "admin.announcement_publish", old.id, {
      targetName: old.title,
      reason: scheduled ? "定时发送全站公告" : "立即发送全站公告",
      startsAt: start.toISOString(),
      expiresAt: end.toISOString(),
    });
    return present(row!);
  });
  changed();
  return result;
}
export async function withdrawAnnouncement(actor: User, id: string) {
  const result = await db.transaction(async (tx) => {
    await requireManagement(tx, actor.id, "announcements.manage");
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${announcementLock})`);
    const [old] = await tx
      .select()
      .from(announcements)
      .where(eq(announcements.id, uuid(id)))
      .for("update");
    if (!old) fail(404, "ANNOUNCEMENT_NOT_FOUND", "公告不存在");
    if (old.status === "withdrawn") return present(old);
    const [row] = await tx
      .update(announcements)
      .set({ status: "withdrawn", updatedAt: new Date() })
      .where(eq(announcements.id, old.id))
      .returning();
    await audit(tx, actor.id, "admin.announcement_withdraw", old.id, {
      targetName: old.title,
      reason: "撤回全站公告",
    });
    return present(row!);
  });
  changed();
  return result;
}
export async function announcementFeed() {
  const now = new Date();
  const rows = await db
    .select()
    .from(announcements)
    .where(
      and(
        eq(announcements.status, "published"),
        or(
          gt(announcements.expiresAt, now),
          gte(announcements.publishedAt, new Date(now.getTime() - 30 * day)),
        ),
      ),
    )
    .orderBy(
      desc(sql`CASE WHEN ${announcements.expiresAt}>${now} THEN 1 ELSE 0 END`),
      desc(announcements.publishedAt),
      announcements.id,
    )
    .limit(150);
  return {
    serverTime: now.toISOString(),
    items: rows.map((r) => present(r, now.getTime())),
  };
}
export async function announcementInbox(actor: User) {
  const feed = await announcementFeed();
  const receipts = feed.items.length
    ? await db
        .select()
        .from(announcementReceipts)
        .where(
          and(
            eq(announcementReceipts.userId, actor.id),
            inArray(
              announcementReceipts.announcementId,
              feed.items.map((a) => a.id),
            ),
          ),
        )
    : [];
  return {
    ...feed,
    items: feed.items.map((a) => {
      const receipt = receipts.find((r) => r.announcementId === a.id);
      return { ...a, received: !!receipt, read: !!receipt?.readAt };
    }),
  };
}
export async function receiveAnnouncement(
  actor: User,
  id: string,
  read = false,
) {
  return db.transaction(async (tx) => {
    const [a] = await tx
      .select()
      .from(announcements)
      .where(
        and(
          eq(announcements.id, uuid(id)),
          eq(announcements.status, "published"),
        ),
      )
      .for("share");
    if (!a) fail(404, "ANNOUNCEMENT_NOT_FOUND", "公告不存在或已撤回");
    const now = new Date();
    if (!read && (!a.expiresAt || a.expiresAt <= now)) return { remind: false };
    if (read) {
      await tx
        .insert(announcementReceipts)
        .values({
          announcementId: a.id,
          userId: actor.id,
          receivedAt: now,
          readAt: now,
        })
        .onConflictDoUpdate({
          target: [
            announcementReceipts.announcementId,
            announcementReceipts.userId,
          ],
          set: { readAt: now },
        });
      return { remind: false };
    }
    const inserted = await tx
      .insert(announcementReceipts)
      .values({ announcementId: a.id, userId: actor.id, receivedAt: now })
      .onConflictDoNothing()
      .returning({ id: announcementReceipts.announcementId });
    return { remind: inserted.length > 0 };
  });
}
// Called at startup and at the next start/end deadline. A single advisory lock
// serializes scheduler recovery with admin publication/withdrawal.
export async function reconcileAnnouncements() {
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${announcementLock})`);
    await tx
      .update(announcements)
      .set({ status: "published", publishedAt: now, updatedAt: now })
      .where(
        and(
          eq(announcements.status, "scheduled"),
          lte(announcements.startsAt, now),
          gt(announcements.expiresAt, now),
        ),
      );
  });
  const rows = await db
    .select({
      id: announcements.id,
      status: announcements.status,
      start: announcements.startsAt,
      end: announcements.expiresAt,
    })
    .from(announcements)
    .where(
      and(
        inArray(announcements.status, ["scheduled", "published"]),
        gt(announcements.expiresAt, now),
      ),
    );
  const active = rows
    .filter((r) => r.status === "published")
    .map((r) => r.id)
    .sort()
    .join(":");
  const deadlines = rows
    .flatMap((r) => [
      r.status === "scheduled" ? r.start?.getTime() : undefined,
      r.end?.getTime(),
    ])
    .filter((n): n is number => n !== undefined && n > now.getTime());
  return { active, next: Math.min(now.getTime() + 60_000, ...deadlines) };
}
export function announceScheduleChange() {
  changed();
}
export async function receiveAnnouncements(
  actor: User,
  ids: string[],
  read = false,
) {
  return db.transaction(async (tx) => {
    const now = new Date();
    const rows = await tx
      .select({ id: announcements.id })
      .from(announcements)
      .where(
        and(
          inArray(announcements.id, ids),
          eq(announcements.status, "published"),
          read ? undefined : gt(announcements.expiresAt, now),
        ),
      )
      .orderBy(announcements.id)
      .for("share");
    if (!rows.length) return { remindIds: [] };
    const insert = tx.insert(announcementReceipts).values(
      rows.map((r) => ({
        announcementId: r.id,
        userId: actor.id,
        receivedAt: now,
        readAt: read ? now : null,
      })),
    );
    if (read) {
      await insert.onConflictDoUpdate({
        target: [
          announcementReceipts.announcementId,
          announcementReceipts.userId,
        ],
        set: { readAt: now },
      });
      return { remindIds: [] };
    }
    const inserted = await insert
      .onConflictDoNothing()
      .returning({ id: announcementReceipts.announcementId });
    return { remindIds: inserted.map((r) => r.id) };
  });
}
