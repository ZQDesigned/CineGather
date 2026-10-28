import { useEffect } from "react";
import { App, Button } from "antd";
import { showRoomChat } from "../controller";
import { useApp, update } from "../store";
import {
  publishClientNotification,
  clientNotificationEnabled,
} from "../client-notifications";

export function Feedback() {
  const chatNotification = useApp((s) => s.chatNotification);
  const chatUnread = useApp((s) => s.chat.unread);
  const error = useApp((state) => state.error);
  const notice = useApp((state) => state.notice);
  const warning = useApp((state) => state.warning);
  const warningTitle = useApp((state) => state.warningTitle);
  const { message, notification } = App.useApp();
  useEffect(() => {
    if (!chatUnread) notification.destroy("room-chat");
  }, [chatUnread, notification]);
  useEffect(() => {
    if (!chatNotification) return;
    const { roomId, message: item } = chatNotification;
    publishClientNotification({
      eventId: "chat:" + item.id,
      groupId: "chat:" + roomId,
      category: "chat",
      title: `${item.displayName} 发来消息`,
      body: item.body.slice(0, 300),
      target: "chat",
      roomId,
    });
    if (!clientNotificationEnabled("chat")) {
      if (useApp.getState().chatNotification === chatNotification)
        update({ chatNotification: undefined });
      return;
    }
    const open = () => {
      showRoomChat(roomId);
      notification.destroy("room-chat");
    };
    notification.info({
      key: "room-chat",
      title: `${item.displayName} 发来消息`,
      description: (
        <div className="chat-notification">
          <p>{item.body.slice(0, 160)}</p>
          <Button
            size="small"
            type="link"
            onClick={(event) => {
              event.stopPropagation();
              open();
            }}
          >
            查看消息
          </Button>
        </div>
      ),
      onClick: open,
      duration: 5,
      role: "status",
    });
    if (useApp.getState().chatNotification === chatNotification)
      update({ chatNotification: undefined });
  }, [chatNotification, notification]);
  useEffect(() => {
    if (!notice) return;
    void message.success({
      key: "operation-notice",
      content: <span role="status">{notice}</span>,
      duration: 3,
    });
    if (useApp.getState().notice === notice) update({ notice: undefined });
  }, [notice, message]);
  useEffect(() => {
    if (!error) return;
    notification.error({
      key: "operation-error",
      title: "操作未完成",
      description: error,
      role: "alert",
      duration: 8,
      pauseOnHover: true,
    });
    if (useApp.getState().error === error) update({ error: undefined });
  }, [error, notification]);
  useEffect(() => {
    if (!warning) return;
    publishClientNotification({
      eventId: `warning:${Date.now()}:${warning.slice(0, 70)}`,
      category: "system",
      title: warningTitle ?? "已离开房间",
      body: warning.slice(0, 300),
      target: "diagnostics",
    });
    notification.warning({
      key: "operation-warning",
      title: warningTitle ?? "已离开房间",
      description: warning,
      role: "alert",
      duration: 8,
      pauseOnHover: true,
    });
    if (useApp.getState().warning === warning)
      update({ warning: undefined, warningTitle: undefined });
  }, [warning, warningTitle, notification]);
  return null;
}
