import {
  Alert,
  Button,
  Empty,
  Popover,
  Select,
  Slider,
  Space,
  Spin,
  Tooltip,
} from "antd";
import styled from "@emotion/styled";
import { Music2, RefreshCw, Square, Volume2 } from "lucide-react";
import { useRef, useState, useEffect } from "react";
import { useApp } from "../store";
import * as actions from "../controller";
const Panel = styled.div`
  width: 300px;
  max-width: calc(100vw - 48px);
  display: flex;
  flex-direction: column;
  gap: 16px;
  .accompaniment-heading,
  .accompaniment-volume {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .accompaniment-heading {
    font-weight: 600;
  }
  .accompaniment-heading .ant-btn {
    margin-left: auto;
  }
  .accompaniment-volume output {
    margin-left: auto;
    font-variant-numeric: tabular-nums;
  }
  .ant-select {
    width: 100%;
  }
  .ant-slider {
    margin: 12px 6px 0;
  }
  .accompaniment-error {
    font-size: 12px;
  }
`;
export function AccompanimentControl({ disabled }: { disabled: boolean }) {
  const app = useApp();
  const [open, setOpen] = useState(false);
  const [sources, setSources] = useState<{ id: string; name: string }[]>([]);
  const [selected, setSelected] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const request = useRef(0);
  const bridge = window.desktop?.accompaniment;
  const active = app.accompaniment.status === "active";
  const starting = app.accompaniment.status === "starting";
  const refresh = async () => {
    const revision = ++request.current;
    setLoading(true);
    setError(undefined);
    setSelected(undefined);
    try {
      const items = await bridge!.sources();
      if (revision === request.current)
        setSources(items.sort((a, b) => a.name.localeCompare(b.name, "zh-CN")));
    } catch {
      if (revision === request.current)
        setError("无法获取应用列表，请检查系统权限后重试");
    } finally {
      if (revision === request.current) setLoading(false);
    }
  };
  useEffect(
    () => () => {
      ++request.current;
    },
    [],
  );
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  return (
    <Popover
      open={open}
      onOpenChange={(value) => {
        if (value && (disabled || !bridge)) return;
        setOpen(value);
        if (value) void refresh();
        else ++request.current;
      }}
      trigger="click"
      placement="top"
      content={
        <Panel>
          <div className="accompaniment-heading">
            <Music2 size={16} />
            应用伴奏
            <Button
              type="text"
              size="small"
              aria-label="刷新伴奏来源"
              icon={<RefreshCw size={14} />}
              disabled={loading || starting}
              onClick={() => void refresh()}
            />
          </div>
          {error && (
            <Alert type="error" className="accompaniment-error" title={error} />
          )}
          <Spin spinning={loading}>
            <Select
              aria-label="伴奏来源"
              placeholder="选择播放音乐的应用"
              showSearch={{ optionFilterProp: "label" }}
              virtual={false}
              getPopupContainer={(trigger) => trigger.parentElement!}
              value={selected}
              onChange={setSelected}
              disabled={starting || loading}
              options={sources.map((source) => ({
                value: source.id,
                label: source.name,
              }))}
              notFoundContent={
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="暂无可用应用"
                />
              }
            />
          </Spin>
          <div>
            <div className="accompaniment-volume">
              <Volume2 size={15} />
              <span>伴奏音量</span>
              <output>{app.accompaniment.volume}%</output>
            </div>
            <Slider
              ariaLabelForHandle="伴奏音量"
              min={0}
              max={100}
              value={app.accompaniment.volume}
              tooltip={{ open: false }}
              onChange={actions.accompanimentVolume}
            />
          </div>
          <Space>
            <Button
              type="primary"
              disabled={!selected || disabled || loading}
              loading={starting}
              onClick={() => {
                if (selected)
                  void actions.run(() => actions.accompaniment.start(selected));
              }}
            >
              开启伴奏
            </Button>
            {(active || starting) && (
              <Button
                icon={<Square size={12} />}
                onClick={() =>
                  void actions.run(() => actions.accompaniment.stop())
                }
              >
                停止伴奏
              </Button>
            )}
          </Space>
        </Panel>
      }
    >
      <Tooltip
        title={
          !bridge
            ? "指定应用伴奏需要 Windows 或 macOS 桌面客户端"
            : disabled
              ? "请先连接房间并确认开麦权限"
              : undefined
        }
      >
        <span>
          <Button
            type="text"
            className={`control-button ${active ? "sharing-control" : ""}`}
            disabled={disabled || !bridge}
            aria-pressed={active}
            aria-label="应用伴奏"
          >
            <Music2 size={21} />
            <span>
              {starting ? "正在开启伴奏" : active ? "伴奏中" : "应用伴奏"}
            </span>
          </Button>
        </span>
      </Tooltip>
    </Popover>
  );
}
