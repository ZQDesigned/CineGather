import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { Alert, App, Button, Flex, Progress, Switch, Typography } from "antd";
import type { DesktopHotStatus } from "@cinegather/contracts";
import { useApp, update } from "../../../store";
import { saveSettings } from "../../../controller";
const useHot = create<{ status?: DesktopHotStatus }>(() => ({}));
export function HotUpdateCenter() {
  const { notification } = App.useApp();
  const announced = useRef(new Set<number>());
  useEffect(() => {
    const bridge = window.desktop?.hotUpdates;
    if (!bridge) return;
    let ended = false,
      revision = 0;
    const accept = (status?: DesktopHotStatus) => {
      if (ended || !status?.enabled) return;
      useHot.setState({ status });
      if (
        status.required &&
        status.revision &&
        !announced.current.has(status.revision)
      ) {
        announced.current.add(status.revision);
        notification.info({
          key: "desktop-ui-required",
          title: "资源需要更新",
          description:
            "当前房间和游戏联机可继续使用，结束后将应用更新。新业务可能需要更新后才能开始。",
          duration: 10,
          actions: (
            <Button size="small" onClick={() => update({ modal: "updates" })}>
              查看更新
            </Button>
          ),
        });
      }
    };
    const required = () =>
      notification.info({
        key: "desktop-ui-required",
        title: "此功能需要更新资源",
        description: "请先结束当前业务并保存编辑内容，再应用资源更新。",
        duration: 10,
        actions: (
          <Button size="small" onClick={() => update({ modal: "updates" })}>
            查看更新
          </Button>
        ),
      });
    window.addEventListener("desktop-ui-required", required);
    const stop = bridge.onChange((s) => {
      ++revision;
      accept(s);
    });
    const initial = revision;
    void bridge
      .status()
      .then((s) => {
        if (initial === revision) accept(s);
      })
      .catch(() => {});
    return () => {
      ended = true;
      window.removeEventListener("desktop-ui-required", required);
      stop();
    };
  }, [notification]);
  return null;
}
export function HotUpdatePanel() {
  const status = useHot((s) => s.status),
    settings = useApp((s) => s.settings);
  const [error, setError] = useState<string>();
  const bridge = window.desktop?.hotUpdates;
  if (!status?.enabled || !bridge) return null;
  const invoke = async (run: () => Promise<unknown>) => {
    setError(undefined);
    try {
      await run();
    } catch {
      setError("资源更新未完成，请稍后重试。");
    }
  };
  const labels: Record<DesktopHotStatus["phase"], string> = {
    idle: "资源已就绪",
    checking: "正在检查资源更新…",
    available: "有资源更新可用",
    downloading: "正在下载资源更新…",
    ready: "资源更新已下载，空闲或下次启动时生效",
    applying: "正在应用资源更新…",
    error: "资源更新未完成",
  };
  const busy = ["checking", "downloading", "applying"].includes(status.phase);
  return (
    <Flex
      data-hot-update-safe
      vertical
      gap={12}
      style={{ borderTop: "1px solid var(--ant-color-border)", paddingTop: 16 }}
    >
      <Typography.Title level={5} style={{ margin: 0 }}>
        资源版本
      </Typography.Title>
      <Typography.Text>
        当前资源版本 {status.identity.revision}{" "}
        {status.identity.revision === 0 ? "（随安装包提供）" : ""}
      </Typography.Text>
      <Typography.Text role="status">{labels[status.phase]}</Typography.Text>
      {status.notes && (
        <Typography.Paragraph style={{ margin: 0, whiteSpace: "pre-wrap" }}>
          {status.notes}
        </Typography.Paragraph>
      )}
      {status.required && (
        <Alert
          type="info"
          showIcon
          title="需要应用资源更新后才能开始相关新业务，当前业务不受影响。"
        />
      )}
      {(status.error || error) && (
        <Alert type="warning" showIcon title={error ?? status.error} />
      )}
      {status.blocked && (
        <Typography.Text type="secondary">{status.blocked}</Typography.Text>
      )}
      {status.phase === "downloading" && (
        <Progress percent={Math.floor(status.progress ?? 0)} />
      )}
      {window.desktop?.platform === "darwin" && (
        <Flex justify="space-between" align="center">
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
      <Flex gap={8} wrap>
        <Button
          disabled={busy}
          loading={status.phase === "checking"}
          onClick={() => void invoke(() => bridge.check())}
        >
          检查资源更新
        </Button>
        {["available", "error"].includes(status.phase) &&
          status.revision !== undefined && (
            <Button
              disabled={busy}
              onClick={() => void invoke(() => bridge.download())}
            >
              下载资源更新
            </Button>
          )}
        {status.phase === "ready" && (
          <Button
            type="primary"
            onClick={() => void invoke(() => bridge.apply())}
          >
            立即应用
          </Button>
        )}
      </Flex>
    </Flex>
  );
}
