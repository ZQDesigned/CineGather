import { App, Avatar, Badge, Button, Empty, List, Space, Tooltip } from "antd";
import { Mail } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { unwrap } from "@cinegather/api-client";
import * as actions from "../controller";
import { useApp, update } from "../store";
import { ModalShell } from "./Modal";
import { useDialogOpen } from "./Modal";
import type { RoomInvitation } from "@cinegather/contracts";
import { friendPresenceLabel } from "../friends";
import {
  publishClientNotification,
  clientNotificationEnabled,
} from "../client-notifications";

export function FriendRoomPicker({ roomId }: { roomId: string }) {
  const friends = useApp((state) => state.friends).filter(
    (friend) => friend.status === "accepted",
  );
  const media = useApp((state) => state.media);
  const current = useApp((state) => state.room);
  const [sent, setSent] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState<string>();
  const open = useDialogOpen();
  useEffect(() => {
    void actions.refreshFriends().catch(actions.report);
  }, []);
  const send = async (userId: string) => {
    if (sending || !open || current?.id !== roomId) return;
    setSending(userId);
    try {
      unwrap(
        await actions.api.POST("/api/v1/rooms/{roomId}/friend-invitations", {
          params: { path: { roomId } },
          body: { userId },
        }),
      );
      setSent((previous) => new Set([...previous, userId]));
      update({ notice: "房间邀请已发送" });
    } catch (error) {
      actions.report(error);
    } finally {
      setSending(undefined);
    }
  };
  return (
    <List
      className="room-invitation-list"
      dataSource={friends}
      locale={{
        emptyText: (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="还没有可以邀请的好友"
          />
        ),
      }}
      renderItem={(friend) => {
        const present = media.participants.some(
          (person) => person.id === friend.userId,
        );
        const invited = sent.has(friend.userId);
        return (
          <List.Item
            key={friend.userId}
            actions={[
              <Button
                key="invite"
                type="primary"
                aria-label={
                  invited
                    ? `已邀请${friend.displayName}`
                    : `邀请${friend.displayName}加入房间`
                }
                disabled={
                  invited ||
                  present ||
                  Boolean(sending) ||
                  !open ||
                  current?.id !== roomId
                }
                loading={sending === friend.userId}
                onClick={() => void send(friend.userId)}
              >
                {present ? "已在房间" : invited ? "已邀请" : "邀请"}
              </Button>,
            ]}
          >
            <List.Item.Meta
              avatar={
                <Avatar className="amber">{friend.displayName[0]}</Avatar>
              }
              title={friend.displayName}
              description={friendPresenceLabel(friend)}
            />
          </List.Item>
        );
      }}
    />
  );
}

export function RoomInvitationInboxButton() {
  const invitations = useApp((state) => state.roomInvitations);
  if (!invitations.length) return null;
  return (
    <Tooltip title="房间邀请">
      <Button
        size="small"
        aria-label="房间邀请"
        icon={<Mail size={15} />}
        onClick={() => void actions.openRoomInvitationInbox()}
      >
        房间邀请
        <Badge count={invitations.length} size="small" />
      </Button>
    </Tooltip>
  );
}

export function RoomInvitationInbox() {
  const invitations = useApp((state) => state.roomInvitations);
  const room = useApp((state) => state.room);
  const busy = useApp((state) => state.busy);
  const { modal } = App.useApp();
  const open = useDialogOpen();
  const join = (invitation: RoomInvitation) => {
    const proceed = () =>
      actions.run(() => actions.acceptRoomInvitation(invitation));
    if (room && room.id !== invitation.roomId)
      modal.confirm({
        title: "切换房间",
        content: `加入“${invitation.roomName}”将离开当前房间。`,
        okText: "离开并加入",
        cancelText: "取消",
        onOk: proceed,
      });
    else void proceed();
  };
  return (
    <ModalShell title="房间邀请">
      <List
        className="room-invitation-list"
        dataSource={invitations}
        locale={{
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="暂无房间邀请"
            />
          ),
        }}
        renderItem={(invitation) => (
          <List.Item
            key={invitation.id}
            actions={[
              <Button
                key="decline"
                disabled={busy || !open}
                onClick={() =>
                  void actions.run(() =>
                    actions.dismissRoomInvitation(invitation.id),
                  )
                }
              >
                拒绝
              </Button>,
              <Button
                key="join"
                type="primary"
                disabled={busy || !open}
                onClick={() => join(invitation)}
              >
                加入房间
              </Button>,
            ]}
          >
            <List.Item.Meta
              title={invitation.roomName}
              description={
                invitation.requestApproved
                  ? `${invitation.senderName} 已同意你的入房申请`
                  : `${invitation.senderName} 邀请你加入`
              }
            />
          </List.Item>
        )}
      />
    </ModalShell>
  );
}

export function RoomInvitationNotifications() {
  const invitations = useApp((state) => state.roomInvitations);
  const userId = useApp((state) => state.user?.id);
  const { notification } = App.useApp();
  const seen = useRef(new Set<string>());
  useEffect(() => {
    const previous = seen.current;
    seen.current = new Set();
    for (const id of previous) notification.destroy(`room-invitation:${id}`);
    return () => {
      for (const id of seen.current)
        notification.destroy(`room-invitation:${id}`);
      seen.current.clear();
    };
  }, [userId, notification]);
  useEffect(() => {
    for (const id of seen.current)
      if (!invitations.some((invitation) => invitation.id === id)) {
        notification.destroy(`room-invitation:${id}`);
        seen.current.delete(id);
      }
    for (const invitation of invitations) {
      if (seen.current.has(invitation.id)) continue;
      // Approved applications are consumed automatically by their originating
      // window. Keep the inbox for recovery, without a second acceptance prompt.
      if (invitation.requestApproved) continue;
      seen.current.add(invitation.id);
      publishClientNotification({
        eventId: "invitation:" + invitation.id,
        category: "invitation",
        title: `${invitation.senderName} 邀请你加入房间`,
        body: invitation.roomName,
        target: "room-invitations",
        entityId: invitation.id,
        expiresAt: Date.parse(invitation.expiresAt),
      });
      if (!clientNotificationEnabled("invitation")) continue;
      notification.info({
        key: `room-invitation:${invitation.id}`,
        title: invitation.requestApproved
          ? `${invitation.senderName} 已同意你的入房申请`
          : `${invitation.senderName} 邀请你加入房间`,
        description: (
          <Space direction="vertical">
            <span>{invitation.roomName}</span>
            <Button
              type="link"
              onClick={() => void actions.openRoomInvitationInbox()}
            >
              查看邀请
            </Button>
          </Space>
        ),
        duration: 8,
        role: "status",
      });
    }
  }, [invitations, notification]);
  return null;
}
