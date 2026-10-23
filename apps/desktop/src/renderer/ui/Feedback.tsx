import { useEffect } from "react";
import { App } from "antd";
import { useApp, update } from "../store";

export function Feedback() {
  const error = useApp((state) => state.error);
  const notice = useApp((state) => state.notice);
  const warning = useApp((state) => state.warning);
  const warningTitle = useApp((state) => state.warningTitle);
  const { message, notification } = App.useApp();
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
