import { useEffect, useRef, useState } from "react";
import { Popover, Select, Switch, Slider } from "antd";
import styled from "@emotion/styled";
import { ChevronUp } from "lucide-react";
import type { DesktopSettings } from "@cinegather/contracts";
import { Button } from "./Controls";
import { useApp } from "../store";
import { audioDeviceOptions } from "../audio-devices";
import { capabilities } from "../platform";
import * as actions from "../controller";

const Panel = styled.div`
  width: 280px;
  max-width: calc(100vw - 48px);
  display: flex;
  flex-direction: column;
  gap: 14px;
  .audio-quick-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .audio-quick-label {
    font-size: 12px;
    color: var(--muted);
  }
  .ant-select {
    width: 100%;
  }
  .audio-monitor {
    border-top: 1px solid var(--line);
    padding-top: 12px;
  }
  .audio-monitor-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .audio-monitor-note {
    font-size: 12px;
    color: var(--muted);
    margin-top: 6px;
  }
  .ant-slider {
    margin: 12px 6px 2px;
  }
`;
type AudioKey = "inputDevice" | "outputDevice" | "noiseReduction";
export function AudioQuickControl({ disabled }: { disabled: boolean }) {
  const settings = useApp((s) => s.settings);
  const devices = useApp((s) => s.audioDevices);
  const monitor = useApp((s) => s.microphoneMonitor);
  const canOpen = !disabled || monitor.state !== "off";
  const platform = capabilities();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const working = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!canOpen) setOpen(false);
  }, [canOpen]);
  useEffect(() => {
    if (!open) return;
    let current = true;
    setLoading(true);
    void actions
      .refreshAudioDevices()
      .catch(actions.report)
      .finally(() => {
        if (current) setLoading(false);
      });
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    };
    window.addEventListener("keydown", escape);
    return () => {
      current = false;
      window.removeEventListener("keydown", escape);
    };
  }, [open]);
  const change = async <K extends AudioKey>(
    key: K,
    value: DesktopSettings[K],
  ) => {
    if (disabled || working.current) return;
    working.current = true;
    setSaving(true);
    try {
      await actions.setRoomAudioSetting(key, value);
    } catch (error) {
      actions.report(error);
    } finally {
      working.current = false;
      setSaving(false);
    }
  };
  const busy = disabled || loading || saving;
  return (
    <Popover
      trigger="click"
      placement="topLeft"
      open={open && canOpen}
      onOpenChange={(value) => {
        if (canOpen) setOpen(value);
      }}
      content={
        <Panel
          role="region"
          aria-label="音频快捷设置"
          aria-busy={loading || saving}
        >
          <div className="audio-quick-field">
            <span className="audio-quick-label">麦克风</span>
            <Select
              aria-label="麦克风"
              value={settings.inputDevice}
              disabled={busy || !platform.microphone}
              onChange={(value) => void change("inputDevice", value)}
              options={audioDeviceOptions(
                "audioinput",
                devices,
                settings.inputDevice,
              )}
            />
          </div>
          <div className="audio-quick-field">
            <span className="audio-quick-label">麦克风降噪</span>
            <Select
              aria-label="麦克风降噪"
              value={settings.noiseReduction}
              disabled={busy || !platform.microphone}
              onChange={(value) => void change("noiseReduction", value)}
              options={[
                { value: "enhanced", label: "增强降噪" },
                { value: "basic", label: "基础降噪" },
                { value: "off", label: "关闭降噪" },
              ]}
            />
          </div>
          <div className="audio-quick-field">
            <span className="audio-quick-label">扬声器 / 耳机</span>
            <Select
              aria-label="扬声器 / 耳机"
              value={settings.outputDevice}
              disabled={busy || !platform.outputSelection}
              onChange={(value) => void change("outputDevice", value)}
              options={audioDeviceOptions(
                "audiooutput",
                devices,
                settings.outputDevice,
              )}
            />
          </div>
          <div className="audio-monitor">
            <div className="audio-monitor-heading">
              <span>耳返</span>
              <Switch
                aria-label="耳返"
                checked={monitor.state !== "off"}
                disabled={
                  (disabled || !platform.microphone) && monitor.state === "off"
                }
                onChange={(value) =>
                  void actions
                    .toggleMicrophoneMonitor(value)
                    .catch(actions.report)
                }
              />
            </div>
            <div className="audio-monitor-note">请佩戴耳机使用，避免回声</div>
            {monitor.state !== "off" && (
              <>
                <div className="audio-monitor-heading audio-monitor-note">
                  <span>
                    {monitor.state === "starting" ? "正在开启耳返" : "耳返音量"}
                  </span>
                  <output>{monitor.volume}%</output>
                </div>
                <Slider
                  ariaLabelForHandle="耳返音量"
                  min={0}
                  max={100}
                  step={1}
                  value={monitor.volume}
                  tooltip={{ open: false }}
                  onChange={(value) => actions.microphoneMonitor.volume(value)}
                  onChangeComplete={(value) =>
                    void actions
                      .setMicrophoneMonitorVolume(value)
                      .catch(actions.report)
                  }
                />
              </>
            )}
          </div>
        </Panel>
      }
    >
      <Button
        ref={trigger}
        type="text"
        className="audio-quick-trigger"
        aria-label="音频快捷设置"
        aria-expanded={open && canOpen}
        disabled={!canOpen}
      >
        <ChevronUp size={15} />
      </Button>
    </Popover>
  );
}
