import {
  publishClientNotification,
  clientNotificationEnabled,
} from "../client-notifications";

import { App, Badge, Button, Empty, List, Space } from "antd";
import { UserPlus } from "lucide-react";
import { useEffect, useRef } from "react";
import type { Friend } from "../friends";
import { useApp } from "../store";
import * as actions from "../controller";
import { ModalShell, useDialogOpen } from "./Modal";

export function FriendRoomJoinButton({ friend }: { friend: Friend }) {
  const requests = useApp((s) => s.roomJoinRequests);
  const media = useApp((s) => s.media);
  const busy = useApp((s) => s.busy);
  if (friend.status !== "accepted" || !friend.online || !friend.room)
    return null;
  const present =
    media.state === "connected" &&
    media.participants.some((p) => p.id === friend.userId);
  const pending = requests.some(
    (r) => !r.incoming && r.userId === friend.userId && r.status === "pending",
  );
  return (
    <Button
      key="join-room"
      disabled={busy || present || pending}
      onClick={() =>
        void actions.run(() => actions.requestFriendRoom(friend.userId))
      }
    >
      {present ? "已在同一房间" : pending ? "等待好友处理" : "申请加入"}
    </Button>
  );
}
export function RoomRequestInboxButton() {
  const count = useApp(
    (s) =>
      s.roomJoinRequests.filter((r) => r.incoming && r.status === "pending")
        .length,
  );
  if (!count) return null;
  return (
    <Button
      size="small"
      aria-label="入房申请"
      icon={<UserPlus size={15} />}
      onClick={() => void actions.openRoomRequestInbox()}
    >
      入房申请 <Badge count={count} size="small" />
    </Button>
  );
}
export function RoomRequestInbox() {
  const requests = useApp((s) => s.roomJoinRequests).filter(
    (r) => r.incoming && r.status === "pending",
  );
  const busy = useApp((s) => s.busy);
  const open = useDialogOpen();
  return (
    <ModalShell title="入房申请">
      <List
        className="room-invitation-list"
        dataSource={requests}
        locale={{
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="暂无入房申请"
            />
          ),
        }}
        renderItem={(request) => (
          <List.Item
            key={request.id}
            actions={[
              <Button
                key="reject"
                disabled={busy || !open}
                onClick={() =>
                  void actions.run(() =>
                    actions.decideRoomRequest(request.id, false),
                  )
                }
              >
                拒绝
              </Button>,
              <Button
                key="approve"
                type="primary"
                disabled={busy || !open}
                onClick={() =>
                  void actions.run(() =>
                    actions.decideRoomRequest(request.id, true),
                  )
                }
              >
                同意
              </Button>,
            ]}
          >
            <List.Item.Meta
              title={request.displayName}
              description="申请加入你所在的房间"
            />
          </List.Item>
        )}
      />
    </ModalShell>
  );
}
export function RoomRequestNotifications() {
  const requests = useApp((s) => s.roomJoinRequests);
  const userId = useApp((s) => s.user?.id);
  const { notification } = App.useApp();
  const seen = useRef(new Set<string>());
  useEffect(() => {
    for (const id of seen.current) notification.destroy(`room-request:${id}`);
    seen.current.clear();
    return () => {
      for (const id of seen.current) notification.destroy(`room-request:${id}`);
      seen.current.clear();
    };
  }, [userId, notification]);
  useEffect(() => {
    const relevant = requests.filter((r) =>
      r.incoming ? r.status === "pending" : r.status === "rejected",
    );
    for (const id of seen.current)
      if (!relevant.some((r) => r.id === id)) {
        notification.destroy(`room-request:${id}`);
        seen.current.delete(id);
      }
    for (const request of relevant) {
      if (seen.current.has(request.id)) continue;
      seen.current.add(request.id);
      publishClientNotification({
        eventId: `room-request:${request.id}:${request.status}`,
        category: "room-request",
        title: request.incoming
          ? `${request.displayName} 申请加入你所在的房间`
          : `${request.displayName} 拒绝了你的入房申请`,
        target: "room-requests",
        entityId: request.id,
        expiresAt: Date.parse(request.expiresAt),
      });
      if (!clientNotificationEnabled("room-request")) continue;
      if (request.incoming)
        notification.info({
          key: `room-request:${request.id}`,
          title: `${request.displayName} 申请加入你所在的房间`,
          description: (
            <Space>
              <Button
                type="link"
                onClick={() => void actions.openRoomRequestInbox()}
              >
                查看申请
              </Button>
            </Space>
          ),
          duration: 8,
          role: "status",
        });
      else
        notification.warning({
          key: `room-request:${request.id}`,
          title: `${request.displayName} 拒绝了你的入房申请`,
          duration: 8,
          role: "status",
        });
    }
  }, [requests, notification]);
  return null;
}
