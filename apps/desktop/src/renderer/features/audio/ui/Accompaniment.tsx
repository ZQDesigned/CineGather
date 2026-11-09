import {
  Alert,
  Button,
  Empty,
  Popover,
  Radio,
  Select,
  Slider,
  Space,
  Spin,
  Tooltip,
} from "antd";
import styled from "@emotion/styled";
import { Music2, RefreshCw, Square, Volume2 } from "lucide-react";
import { useRef, useState, useEffect } from "react";
import type {
  AccompanimentApplication,
  AccompanimentSource,
} from "@cinegather/contracts";
import { commonAccompanimentApplications } from "../../../../shared/accompaniment-apps";
import qqMusicIcon from "../assets/qqmusic.png";
import neteaseIcon from "../assets/netease.png";
import sodaIcon from "../assets/soda.png";
import kugouIcon from "../assets/kugou.png";
import douyinIcon from "../assets/douyin.png";
import { useApp } from "../../../store";
import * as actions from "../../../controller";
// Product marks from the official QQ Music, NetEase Music, Qishui, Kugou and Douyin sites.
// Bundle locally so the audio picker never depends on third-party image requests.
const applicationIcons = {
  qqmusic: qqMusicIcon,
  netease: neteaseIcon,
  soda: sodaIcon,
  kugou: kugouIcon,
  douyin: douyinIcon,
} satisfies Record<AccompanimentApplication, string>;
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
  .accompaniment-apps {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .accompaniment-apps .ant-radio-wrapper {
    display: flex;
    flex-direction: row-reverse;
    align-items: center;
    gap: 12px;
    margin-inline-end: 0;
    padding: 8px 10px;
    border-radius: 8px;
  }
  .accompaniment-apps .ant-radio-wrapper-checked {
    background: #b39bff14;
  }
  .accompaniment-apps .ant-radio-wrapper > span:last-child {
    flex: 1;
    min-width: 0;
    padding: 0;
  }
  .accompaniment-app-label {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .accompaniment-app-label small {
    font-size: 11px;
  }
  .accompaniment-app-name {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }
  .accompaniment-app-icon {
    width: 20px;
    height: 20px;
    flex-shrink: 0;
    object-fit: contain;
  }
  .ant-radio-wrapper-disabled .accompaniment-app-icon {
    opacity: 0.6;
  }
  .accompaniment-custom {
    display: flex;
    flex-direction: column;
    gap: 8px;
    border-top: 1px solid var(--line);
    padding-top: 12px;
  }
  .accompaniment-custom-label {
    color: var(--muted);
    font-size: 12px;
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
  const [sources, setSources] = useState<AccompanimentSource[]>([]);
  const [selectedKey, setSelectedKey] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const request = useRef(0);
  const bridge = window.desktop?.accompaniment;
  const active = app.accompaniment.status === "active";
  const starting = app.accompaniment.status === "starting";
  const selected = sources.find(
    (source) => source.selectionKey === selectedKey,
  );
  const selectedActive = Boolean(
    active &&
      selected &&
      (selected.active || selected.id === app.accompaniment.source),
  );
  const commonSources = commonAccompanimentApplications.map((application) => ({
    ...application,
    source:
      sources.find(
        (item) =>
          item.application === application.id &&
          item.selectionKey === selectedKey,
      ) ?? sources.find((item) => item.application === application.id),
  }));
  const customSelection = commonSources.some(
    (application) => application.source?.selectionKey === selectedKey,
  )
    ? undefined
    : selectedKey;
  const refresh = async () => {
    const revision = ++request.current;
    setLoading(true);
    setError(undefined);
    try {
      const items = await bridge!.sources();
      // Preserve native order: visible applications precede audio-only subprocesses.
      if (revision === request.current) {
        setSources(items);
        setSelectedKey((previous) =>
          items.some((item) => item.selectionKey === previous)
            ? previous
            : items.find((item) => item.active)?.selectionKey,
        );
      }
    } catch {
      if (revision === request.current) {
        setError("无法获取应用列表，请检查系统权限后重试");
      }
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
            <Radio.Group
              className="accompaniment-apps"
              aria-label="常用伴奏应用"
              value={selectedKey}
              onChange={(event) => setSelectedKey(event.target.value)}
              disabled={disabled || starting || loading || Boolean(error)}
            >
              {commonSources.map(({ id, name, source }) => {
                return (
                  <Radio
                    key={id}
                    value={source?.selectionKey ?? `unavailable:${id}`}
                    disabled={
                      disabled ||
                      starting ||
                      loading ||
                      Boolean(error) ||
                      !source
                    }
                  >
                    <span className="accompaniment-app-label">
                      <span className="accompaniment-app-name">
                        <img
                          className="accompaniment-app-icon"
                          src={applicationIcons[id]}
                          width={20}
                          height={20}
                          alt=""
                          aria-hidden="true"
                          draggable={false}
                        />
                        <span>{name}</span>
                      </span>
                      {(!source || loading) && (
                        <small>{loading ? "读取中" : "未运行"}</small>
                      )}
                    </span>
                  </Radio>
                );
              })}
            </Radio.Group>
          </Spin>
          <div className="accompaniment-custom">
            <span className="accompaniment-custom-label">自选进程</span>
            <Select
              aria-label="自选伴奏进程"
              placeholder="选择其他应用进程"
              showSearch={{ optionFilterProp: "label" }}
              virtual={false}
              getPopupContainer={(trigger) => trigger.parentElement!}
              value={customSelection}
              onChange={setSelectedKey}
              disabled={disabled || starting || loading || Boolean(error)}
              options={[...sources]
                .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"))
                .map((source) => ({
                  value: source.selectionKey,
                  label: source.name,
                }))}
              notFoundContent={
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="暂无可用应用"
                />
              }
            />
          </div>
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
              disabled={
                !selected ||
                selectedActive ||
                disabled ||
                loading ||
                Boolean(error)
              }
              loading={starting}
              onClick={() => {
                if (selected)
                  void actions.run(() =>
                    actions.accompaniment.start(selected.id),
                  );
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
