import { useEffect, useState } from "react";
import { App, Empty, List, Tag, Typography } from "antd";
import { Megaphone } from "lucide-react";
import styled from "@emotion/styled";
import type { Announcement } from "@cinegather/contracts";
import { Button } from "./Controls";
import { ModalShell } from "./Modal";
import { useApp, update } from "../store";
import { announcementActive } from "../announcements";
import { clientNotificationEnabled } from "../client-notifications";
import * as actions from "../controller";
const Banner = styled.div`
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 36px;
  padding: 4px 24px;
  border-bottom: 1px solid #e0b87828;
  background: #44382155;
  color: #ead3a4;
  font-size: 12px;
  .announcement-banner-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
  }
  button {
    flex-shrink: 0;
    color: inherit;
  }
`;
const date = (value: string | null) =>
  value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "未设置";
export function AnnouncementBody({
  item,
  now = Date.now(),
}: {
  item: Announcement;
  now?: number;
}) {
  return (
    <div aria-label="公告正文">
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        <Tag color={item.kind === "maintenance" ? "gold" : "purple"}>
          {item.kind === "maintenance" ? "维护公告" : "全站公告"}
        </Tag>
        <Tag>
          {announcementActive(item, now)
            ? "生效中"
            : item.state === "draft"
              ? "草稿"
              : item.state === "scheduled"
                ? "待发送"
                : item.state === "withdrawn"
                  ? "已撤回"
                  : "已结束"}
        </Tag>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {item.publishedAt
            ? "发布于 " + date(item.publishedAt)
            : item.startsAt
              ? "计划发送 " + date(item.startsAt)
              : "立即发送"}
        </Typography.Text>
      </div>
      <div
        style={{
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
          fontSize: 14,
          lineHeight: 1.85,
          maxHeight: "48vh",
          overflowY: "auto",
        }}
      >
        {item.body}
      </div>
      {item.expiresAt && (
        <Typography.Paragraph
          type="secondary"
          style={{ fontSize: 12, marginTop: 20, marginBottom: 0 }}
        >
          结束时间：{date(item.expiresAt)}
        </Typography.Paragraph>
      )}
    </div>
  );
}
export function AnnouncementLayer() {
  const app = useApp(),
    { notification } = App.useApp();
  const [, setClock] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setClock((v) => v + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  const now = Date.now() + app.announcements.offset;
  const maintenance = app.announcements.items.filter(
    (a) => a.kind === "maintenance" && announcementActive(a, now),
  );
  useEffect(() => {
    if (!app.pendingAnnouncementIds.length) return;
    const ids = app.pendingAnnouncementIds.filter((id) =>
      app.announcements.items.some(
        (a) => a.id === id && announcementActive(a, now),
      ),
    );
    if (!ids.length || !app.user || !clientNotificationEnabled("system")) {
      update({ pendingAnnouncementIds: [] });
      return;
    }
    if (
      app.modal ||
      app.busy ||
      app.requiredUpdate ||
      [...document.querySelectorAll<HTMLElement>(".ant-modal-wrap")].some(
        (el) =>
          el.getClientRects().length > 0 &&
          getComputedStyle(el).visibility !== "hidden",
      )
    )
      return;
    update({
      pendingAnnouncementIds: [],
      selectedAnnouncementId: ids.length === 1 ? ids[0] : undefined,
      announcementAuto: true,
      modal: "announcements",
    });
  }, [
    app.pendingAnnouncementIds,
    app.announcements,
    app.user,
    app.modal,
    app.busy,
    app.requiredUpdate,
    app.settings.notifications,
    now,
  ]);
  useEffect(() => {
    if (!app.announcementToastIds.length) return;
    if (clientNotificationEnabled("system"))
      for (const id of app.announcementToastIds) {
        const a = app.announcements.items.find((a) => a.id === id);
        if (!a || !announcementActive(a, now)) continue;
        notification.info({
          key: "announcement:" + id,
          title: a.title,
          description: (
            <div style={{ whiteSpace: "pre-wrap" }}>{a.body.slice(0, 200)}</div>
          ),
          duration: 10,
          actions: (
            <Button
              onClick={() => {
                notification.destroy("announcement:" + id);
                actions.openAnnouncements(id);
              }}
            >
              查看公告
            </Button>
          ),
        });
      }
    update({ announcementToastIds: [] });
  }, [app.announcementToastIds, app.announcements, notification, now]);
  useEffect(() => {
    const live = new Set(
      app.announcements.items
        .filter((a) => announcementActive(a, now))
        .map((a) => a.id),
    );
    for (const item of app.notifications)
      if (
        item.target === "announcements" &&
        item.entityId &&
        !live.has(item.entityId)
      )
        notification.destroy("announcement:" + item.entityId);
  }, [app.announcements, app.notifications, notification, now]);
  if (!maintenance.length) return null;
  return (
    <Banner role="status" aria-label="维护公告">
      <Megaphone size={15} />
      <span className="announcement-banner-title">
        {maintenance[0]!.title}
        {maintenance.length > 1 ? `（另有 ${maintenance.length - 1} 条）` : ""}
      </span>
      <Button
        size="small"
        type="text"
        onClick={() =>
          actions.openAnnouncements(
            maintenance.length === 1 ? maintenance[0]!.id : undefined,
          )
        }
      >
        查看公告
      </Button>
    </Banner>
  );
}
export function AnnouncementDialog() {
  const snapshot = useApp((s) => s.announcements),
    id = useApp((s) => s.selectedAnnouncementId),
    auto = useApp((s) => s.announcementAuto),
    user = useApp((s) => s.user);
  const [, setClock] = useState(0);
  const item = snapshot.items.find((a) => a.id === id),
    now = Date.now() + snapshot.offset;
  useEffect(() => {
    const timer = setInterval(() => setClock((v) => v + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (id && user) void actions.readAnnouncements([id]).catch(() => {});
  }, [id, user?.id]);
  useEffect(() => {
    if (auto && id && (!item || !announcementActive(item, now)))
      update({ modal: null, announcementAuto: false });
  }, [auto, id, item, now]);
  return (
    <ModalShell
      title={item?.title ?? "全站公告"}
      wide
      footer={
        <>
          {id && (
            <Button
              onClick={() =>
                update({
                  selectedAnnouncementId: undefined,
                  announcementAuto: false,
                })
              }
            >
              公告列表
            </Button>
          )}
          <Button
            type="primary"
            onClick={() => update({ modal: null, announcementAuto: false })}
          >
            知道了
          </Button>
        </>
      }
    >
      {id ? (
        item ? (
          <AnnouncementBody item={item} now={now} />
        ) : (
          <Empty description="公告已撤回或不再提供" />
        )
      ) : (
        <div style={{ maxHeight: "56vh", overflowY: "auto" }}>
          <List
            dataSource={snapshot.items}
            locale={{ emptyText: "暂无公告" }}
            renderItem={(a) => (
              <List.Item
                actions={[
                  <Button
                    key="view"
                    type="link"
                    onClick={() => actions.openAnnouncements(a.id)}
                  >
                    查看
                  </Button>,
                ]}
              >
                <List.Item.Meta
                  title={
                    <span>
                      {a.title}{" "}
                      {!snapshot.readIds.includes(a.id) && user && (
                        <Tag color="purple">未读</Tag>
                      )}
                    </span>
                  }
                  description={`${a.kind === "maintenance" ? "维护公告" : "全站公告"} / ${announcementActive(a, now) ? "生效中" : "已结束"} / ${date(a.publishedAt)}`}
                />
              </List.Item>
            )}
          />
        </div>
      )}
    </ModalShell>
  );
}
