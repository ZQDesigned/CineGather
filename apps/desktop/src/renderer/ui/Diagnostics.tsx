import { Alert, Card, Descriptions, Space, Tag, Typography } from "antd";
import { Download, RefreshCw, Settings } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { unwrap } from "@cinegather/api-client";
import { useApp, update } from "../store";
import * as actions from "../controller";
import { verifyServer } from "../server-address";
import { Button } from "./Controls";
import { ModalShell, useDialogOpen } from "./Modal";

export function Diagnostics() {
  const open = useDialogOpen();
  const app = useApp();
  const [connection, setConnection] = useState<
    "checking" | "available" | "unavailable"
  >("checking");
  const [checkedAt, setCheckedAt] = useState<string>();
  const [exporting, setExporting] = useState(false);
  const checkRequest = useRef<AbortController | undefined>(undefined);
  const exportRequest = useRef<AbortController | undefined>(undefined);
  const refresh = async () => {
    checkRequest.current?.abort();
    const request = new AbortController();
    checkRequest.current = request;
    setConnection("checking");
    try {
      await verifyServer(actions.baseUrl, request.signal);
      if (!request.signal.aborted) setConnection("available");
    } catch {
      if (!request.signal.aborted) setConnection("unavailable");
    } finally {
      if (!request.signal.aborted) setCheckedAt(new Date().toISOString());
      if (checkRequest.current === request) checkRequest.current = undefined;
    }
  };
  useEffect(() => {
    if (!open) return;
    void refresh();
    return () => {
      checkRequest.current?.abort();
      exportRequest.current?.abort();
    };
  }, [open]);
  const exportData = async () => {
    if (exportRequest.current) return;
    const request = new AbortController();
    exportRequest.current = request;
    setExporting(true);
    try {
      const [media, server] = await Promise.allSettled([
        actions.media.diagnostics(),
        app.user
          ? actions.api
              .GET("/api/v1/diagnostics", { signal: request.signal })
              .then(unwrap)
          : Promise.resolve(undefined),
      ]);
      if (request.signal.aborted) return;
      const metrics = server.status === "fulfilled" ? server.value : undefined;
      const data = {
        ...(media.status === "fulfilled"
          ? media.value
          : { state: app.media.state, tracks: [] }),
        capturedAt: new Date().toISOString(),
        mediaCheck: media.status === "fulfilled" ? "available" : "unavailable",
        serverCheck: !app.user
          ? "notSignedIn"
          : metrics
            ? "available"
            : "unavailable",
        connection: { status: connection, checkedAt },
        shareState: app.shareState,
        server:
          metrics &&
          Object.fromEntries(
            Object.entries(metrics).filter(
              ([key, value]) =>
                [
                  "uptimeSeconds",
                  "requests",
                  "errors",
                  "authDenied",
                  "tokenIssueFailures",
                  "averageDurationMs",
                  "activeRooms",
                ].includes(key) &&
                typeof value === "number" &&
                Number.isFinite(value),
            ),
          ),
      };
      if (window.desktop) {
        if (await window.desktop.exportDiagnostics(data))
          update({ notice: "诊断已导出" });
      } else {
        const url = URL.createObjectURL(
          new Blob([JSON.stringify(data, null, 2)], {
            type: "application/json",
          }),
        );
        const link = document.createElement("a");
        link.href = url;
        link.download = "cinegather-diagnostics.json";
        link.click();
        URL.revokeObjectURL(url);
      }
    } catch (error) {
      if (!request.signal.aborted) actions.report(error);
    } finally {
      if (exportRequest.current === request) exportRequest.current = undefined;
      if (!request.signal.aborted) setExporting(false);
    }
  };
  const connected = Boolean(app.room && app.roomState === "connected");
  const reconnecting = Boolean(
    app.room && ["joining", "reconnecting"].includes(app.roomState),
  );
  const failed = Boolean(app.room && app.roomState === "failed");
  const unstable =
    connected &&
    app.media.participants.some((person) =>
      ["poor", "lost"].includes(person.quality),
    );
  const microphone = app.media.participants.find(
    (person) => person.local,
  )?.microphone;
  const roomLabel = !app.room
    ? "还未加入房间"
    : connected
      ? "已连接"
      : reconnecting
        ? "正在连接"
        : "连接已断开";
  const voiceLabel = !connected
    ? "加入房间后可用"
    : app.media.audioBlocked
      ? "需要启用声音"
      : microphone
        ? "麦克风已开启"
        : "麦克风已关闭";
  const shareLabel = !connected
    ? "加入房间后可用"
    : app.shareState === "failed"
      ? "共享未成功"
      : app.media.sharer
        ? app.media.sharer.local
          ? "你正在共享"
          : app.watching
            ? "正在观看"
            : "已暂停观看"
        : app.shareState === "active"
          ? "你正在共享"
          : ["acquiringLease", "selectingSource", "publishing"].includes(
                app.shareState,
              )
            ? "正在准备共享"
            : "还未共享画面";
  const title =
    connection === "unavailable"
      ? "暂时无法连接服务器"
      : reconnecting
        ? "正在恢复房间连接"
        : failed
          ? "房间连接已断开"
          : unstable
            ? "网络有些不稳定"
            : connected
              ? "房间连接正常"
              : connection === "checking"
                ? "正在检查连接"
                : "可以加入房间了";
  const description =
    connection === "unavailable"
      ? "请检查网络连接，或在设置中确认服务器地址。"
      : reconnecting
        ? "请稍等，我们正在尝试恢复连接。"
        : failed
          ? "请检查网络，然后重新连接房间。"
          : unstable
            ? "如果声音断续或画面卡顿，可以切换网络后再试。"
            : connected
              ? "可以在这里查看语音和画面的当前状态。"
              : "加入房间后，可以检查语音和共享状态。";
  const status = (label: string, description: string, color?: string) => (
    <Space direction="vertical" size={3}>
      <Tag color={color}>{label}</Tag>
      <Typography.Text type="secondary">{description}</Typography.Text>
    </Space>
  );
  return (
    <ModalShell
      title="连接诊断"
      wide
      footer={
        <>
          {connection === "unavailable" && (
            <Button
              icon={<Settings size={16} />}
              onClick={() => update({ modal: "settings" })}
            >
              打开设置
            </Button>
          )}
          {failed && (
            <Button onClick={() => void actions.run(actions.retryRoom)}>
              重新连接房间
            </Button>
          )}
          <Button
            icon={<RefreshCw size={16} />}
            loading={connection === "checking"}
            onClick={() => void refresh()}
          >
            重新检查
          </Button>
          <Button
            type="primary"
            icon={<Download size={16} />}
            loading={exporting}
            onClick={() => void exportData()}
          >
            导出诊断
          </Button>
        </>
      }
    >
      <Alert
        className="diagnostic-overview"
        showIcon
        type={
          connection === "unavailable" || failed
            ? "error"
            : reconnecting || unstable
              ? "warning"
              : connected
                ? "success"
                : "info"
        }
        title={title}
        description={description}
      />
      <Card size="small" className="diagnostic-status-card">
        <Descriptions
          column={1}
          colon={false}
          items={[
            {
              key: "server",
              label: "服务器连接",
              children: status(
                connection === "checking"
                  ? "正在检查"
                  : connection === "available"
                    ? "可以连接"
                    : "暂时无法连接",
                checkedAt
                  ? `上次检查 ${new Date(checkedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`
                  : "正在确认能否连接映聚服务。",
                connection === "available"
                  ? "success"
                  : connection === "unavailable"
                    ? "error"
                    : undefined,
              ),
            },
            {
              key: "room",
              label: "房间连接",
              children: status(
                roomLabel,
                !app.room
                  ? "进入房间后，会自动连接朋友们。"
                  : connected
                    ? "你和朋友们已在同一个房间。"
                    : "请等待连接恢复，或重新进入房间。",
                connected
                  ? "success"
                  : reconnecting
                    ? "processing"
                    : failed
                      ? "error"
                      : undefined,
              ),
            },
            {
              key: "voice",
              label: "语音聊天",
              children: (
                <Space direction="vertical" size={4}>
                  {status(
                    voiceLabel,
                    !connected
                      ? "进入房间后再检查语音。"
                      : app.media.audioBlocked
                        ? "点击下方按钮，开始接收房间声音。"
                        : !app.voiceVolume
                          ? "房间语音音量为零，调高后才能听到朋友。"
                          : microphone
                            ? "可以和房间里的朋友说话。"
                            : "需要说话时，在房间内开启麦克风即可。",
                    app.media.audioBlocked
                      ? "warning"
                      : microphone
                        ? "success"
                        : undefined,
                  )}
                  {connected && app.media.audioBlocked && (
                    <Button
                      size="small"
                      onClick={() =>
                        void actions.media.startAudio().catch(actions.report)
                      }
                    >
                      启用声音
                    </Button>
                  )}
                </Space>
              ),
            },
            {
              key: "screen",
              label: "画面共享",
              children: status(
                shareLabel,
                !connected
                  ? "进入房间后即可共享或观看画面。"
                  : app.shareState === "failed"
                    ? "请重新选择画面，并确认已允许屏幕录制。"
                    : app.media.sharer
                      ? app.watching || app.media.sharer.local
                        ? "共享声音可在房间内单独调节。"
                        : "在房间内点击继续观看即可恢复。"
                      : "一位成员开始共享后，大家就能一起观看。",
                app.shareState === "failed"
                  ? "error"
                  : app.media.sharer && app.watching
                    ? "success"
                    : undefined,
              ),
            },
          ]}
        />
      </Card>
    </ModalShell>
  );
}
