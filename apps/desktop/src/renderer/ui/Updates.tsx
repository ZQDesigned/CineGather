import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import {
  App,
  Alert,
  Button,
  Flex,
  Progress,
  Typography,
  Modal,
  Switch,
} from "antd";
import type { UpdateStatus } from "@cinegather/contracts";
import { update, useApp } from "../store";
import {
  report,
  requireClientUpdate,
  roomSession,
  saveSettings,
} from "../controller";
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
      if (status.required && status.minimumVersion)
        requireClientUpdate(
          status.minimumVersion,
          status.reason ?? "当前版本已不受支持，请更新后继续使用。",
          false,
        );
    });
    const initial = revision;
    void bridge
      .status()
      .then((status) => {
        if (!ended && initial === revision) {
          useUpdates.setState({ status });
          if (status.required && status.minimumVersion)
            requireClientUpdate(
              status.minimumVersion,
              status.reason ?? "当前版本已不受支持，请更新后继续使用。",
              false,
            );
        }
      })
      .catch(report);
    return () => {
      ended = true;
      stop();
    };
  }, []);
  useEffect(() => {
    if (
      status?.required ||
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
      description: `v${status.latestVersion}${status.status === "downloaded" ? "，下次启动时自动安装" : ""}`,
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
  return <RequiredUpdate />;
}
function updateError(error: unknown) {
  return error instanceof Error
    ? error.message.replace(
        /^Error invoking remote method '[^']+': (?:Error: )?/,
        "",
      )
    : "操作未完成，请重试。";
}
function RequiredUpdate() {
  const requirement = useApp((state) => state.requiredUpdate);
  const status = useUpdates((state) => state.status);
  const [cleaning, setCleaning] = useState(true);
  const [error, setError] = useState<string>();
  const started = useRef(false);
  const cleanup = async () => {
    setCleaning(true);
    setError(undefined);
    update({ modal: null, cinema: false });
    try {
      await roomSession.leave();
      await window.desktop?.updates?.setInRoom(false);
    } catch (error) {
      setError(updateError(error));
    } finally {
      setCleaning(false);
    }
  };
  useEffect(() => {
    if (
      requirement &&
      !started.current &&
      (!window.desktop?.updates || status)
    ) {
      started.current = true;
      if (status?.mode === "install") setCleaning(false);
      else void cleanup();
    }
  }, [requirement, status]);
  if (!requirement) return null;
  return (
    <Modal
      open
      centered
      title="需要更新映聚"
      closable={false}
      keyboard={false}
      maskClosable={false}
      footer={null}
      width={520}
      zIndex={2200}
      styles={{ body: { maxHeight: "min(70dvh, 640px)", overflowY: "auto" } }}
    >
      <Flex vertical gap={16}>
        <Typography.Paragraph style={{ margin: 0 }}>
          {requirement.reason}
        </Typography.Paragraph>
        <Typography.Text type="secondary">
          需要 v{requirement.minimumVersion} 或更新版本才能继续使用。
        </Typography.Text>
        {cleaning ? (
          <Alert type="info" showIcon title="正在退出房间并停止共享…" />
        ) : (
          <>
            {error && (
              <Alert
                type="warning"
                showIcon
                title={error}
                action={
                  <Button size="small" onClick={() => void cleanup()}>
                    重试退出房间
                  </Button>
                }
              />
            )}
            {!window.desktop ? (
              <Button type="primary" onClick={() => location.reload()}>
                刷新页面
              </Button>
            ) : status?.mode === "disabled" ? (
              <Button
                type="primary"
                onClick={() =>
                  void window.desktop?.updates
                    ?.openDownload()
                    .catch((error: unknown) => setError(updateError(error)))
                }
              >
                手动下载新版
              </Button>
            ) : (
              <UpdatePanel />
            )}
          </>
        )}
        {window.desktop?.updates?.quit && (
          <Button
            onClick={() =>
              void window.desktop!.updates!.quit!().catch((error: unknown) =>
                setError(updateError(error)),
              )
            }
          >
            退出映聚
          </Button>
        )}
      </Flex>
    </Modal>
  );
}
export function UpdatePanel() {
  const status = useUpdates((state) => state.status);
  const bridge = window.desktop?.updates;
  const { modal } = App.useApp();
  const settings = useApp((state) => state.settings);
  const [error, setError] = useState<string>();
  const invoke = async (run: () => Promise<unknown>) => {
    setError(undefined);
    try {
      await run();
    } catch (error) {
      setError(updateError(error));
    }
  };
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
    downloaded: "新版已下载，下次启动时自动安装",
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
      {error && <Alert showIcon type="warning" title={error} />}
      {status.mode === "install" && (
        <Flex align="center" justify="space-between" gap={12}>
          <Typography.Text>自动下载更新</Typography.Text>
          <Switch
            aria-label="自动下载更新"
            checked={settings.autoDownloadUpdates ?? true}
            onChange={(enabled) =>
              void invoke(() =>
                saveSettings(
                  { ...settings, autoDownloadUpdates: enabled },
                  false,
                ),
              )
            }
          />
        </Flex>
      )}
      {status.status === "downloading" && (
        <Progress percent={Math.floor(status.progress ?? 0)} />
      )}
      <Flex gap={8} wrap>
        {status.required &&
          status.mode === "install" &&
          status.latestVersion && (
            <Button onClick={() => void invoke(() => bridge.openDownload())}>
              手动下载安装包
            </Button>
          )}
        {status.mode !== "disabled" && (
          <Button
            loading={status.status === "checking"}
            disabled={busy}
            onClick={() => void invoke(() => bridge.check())}
          >
            检查更新
          </Button>
        )}
        {status.latestVersion && status.mode === "notify" && (
          <Button
            type="primary"
            onClick={() => void invoke(() => bridge.openDownload())}
          >
            下载新版
          </Button>
        )}
        {status.latestVersion &&
          status.mode === "install" &&
          ["available", "error"].includes(status.status) && (
            <Button
              type="primary"
              onClick={() => void invoke(() => bridge.download())}
            >
              下载更新
            </Button>
          )}
        {status.status === "downloaded" && status.mode === "install" && (
          <Button
            type="primary"
            onClick={async () => {
              await modal.confirm({
                zIndex: 2300,
                title: "重启并更新映聚？",
                content: status.inRoom
                  ? "将先退出当前房间并停止共享，更新完成后重新打开映聚。"
                  : "更新完成后会重新打开映聚。",
                okText: "重启更新",
                cancelText: "稍后",
                onOk: async () => {
                  try {
                    await roomSession.leave(true, true);
                    await bridge.setInRoom(false);
                    await bridge.install();
                  } catch (error) {
                    report(error);
                    throw error;
                  }
                },
              });
            }}
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
