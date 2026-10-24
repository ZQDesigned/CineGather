import { useEffect, useRef } from "react";
import { create } from "zustand";
import { App, Alert, Button, Flex, Progress, Typography } from "antd";
import type { UpdateStatus } from "@cinegather/contracts";
import { update } from "../store";
import { report } from "../controller";
import { ModalShell } from "./Modal";

const useUpdates = create<{ status?: UpdateStatus }>(() => ({}));
export function UpdateCenter() {
  const status = useUpdates((state) => state.status);
  const { notification } = App.useApp();
  const announced = useRef(new Set<string>());
  useEffect(() => {
    const bridge = window.desktop?.updates;
    if (!bridge) return;
    let revision = 0,
      ended = false;
    const stop = bridge.onChange((status) => {
      ++revision;
      useUpdates.setState({ status });
    });
    const initial = revision;
    void bridge
      .status()
      .then((status) => {
        if (!ended && initial === revision) useUpdates.setState({ status });
      })
      .catch(report);
    return () => {
      ended = true;
      stop();
    };
  }, []);
  useEffect(() => {
    if (
      !status?.latestVersion ||
      !["available", "downloaded"].includes(status.status)
    )
      return;
    const key = `${status.latestVersion}:${status.status}`;
    if (announced.current.has(key)) return;
    announced.current.add(key);
    notification.info({
      key: "client-update",
      title: status.status === "downloaded" ? "新版已下载" : "发现新版映聚",
      description: `v${status.latestVersion}`,
      duration: 8,
      actions: (
        <Button
          size="small"
          type="primary"
          onClick={() => {
            notification.destroy("client-update");
            update({ modal: "updates" });
          }}
        >
          查看更新
        </Button>
      ),
    });
  }, [status, notification]);
  return null;
}
export function UpdatePanel() {
  const status = useUpdates((state) => state.status);
  const bridge = window.desktop?.updates;
  const { modal } = App.useApp();
  if (!bridge || !status) return null;
  const busy = ["checking", "downloading", "installing"].includes(
    status.status,
  );
  const labels: Record<UpdateStatus["status"], string> = {
    disabled: "此版本不提供在线更新",
    idle: "可检查是否有新版",
    checking: "正在检查更新…",
    current: "当前已是最新版本",
    available: "有新版本可用",
    downloading: "正在下载更新…",
    downloaded: "新版已下载，重启后完成更新",
    installing: "正在安装更新…",
    error: "更新未完成",
  };
  return (
    <Flex vertical gap={16}>
      <Typography.Text>当前版本 v{status.currentVersion}</Typography.Text>
      <Typography.Text role="status">{labels[status.status]}</Typography.Text>
      {status.latestVersion && (
        <Typography.Title level={5} style={{ margin: 0 }}>
          新版 v{status.latestVersion}
        </Typography.Title>
      )}
      {status.notes && (
        <Typography.Paragraph style={{ whiteSpace: "pre-wrap", margin: 0 }}>
          {status.notes}
        </Typography.Paragraph>
      )}
      {status.mode === "notify" && (
        <Typography.Text type="secondary">
          macOS 暂需下载后手动安装。
        </Typography.Text>
      )}
      {status.error && <Alert showIcon type="warning" title={status.error} />}
      {status.inRoom && status.mode === "install" && (
        <Alert showIcon type="info" title="离开房间后可下载或安装更新" />
      )}
      {status.status === "downloading" && (
        <Progress percent={Math.floor(status.progress ?? 0)} />
      )}
      <Flex gap={8} wrap>
        {status.mode !== "disabled" && (
          <Button
            loading={status.status === "checking"}
            disabled={busy || status.status === "downloaded"}
            onClick={() => void bridge.check().catch(report)}
          >
            检查更新
          </Button>
        )}
        {status.latestVersion && status.mode === "notify" && (
          <Button
            type="primary"
            onClick={() => void bridge.openDownload().catch(report)}
          >
            下载新版
          </Button>
        )}
        {status.latestVersion &&
          status.mode === "install" &&
          ["available", "error"].includes(status.status) && (
            <Button
              type="primary"
              disabled={status.inRoom}
              onClick={() => void bridge.download().catch(report)}
            >
              下载更新
            </Button>
          )}
        {status.status === "downloaded" && status.mode === "install" && (
          <Button
            type="primary"
            disabled={status.inRoom}
            onClick={() =>
              modal.confirm({
                title: "重启并更新映聚？",
                content: "更新完成后会重新打开映聚。",
                okText: "重启更新",
                cancelText: "稍后",
                onOk: () =>
                  bridge.install().catch((error: unknown) => {
                    report(error);
                    throw error;
                  }),
              })
            }
          >
            重启更新
          </Button>
        )}
      </Flex>
    </Flex>
  );
}
export function UpdateDialog() {
  return (
    <ModalShell
      title="版本更新"
      footer={<Button onClick={() => update({ modal: null })}>关闭</Button>}
    >
      <UpdatePanel />
    </ModalShell>
  );
}
