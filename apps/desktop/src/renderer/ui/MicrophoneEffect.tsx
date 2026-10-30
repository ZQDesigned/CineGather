import { useCallback, useEffect, useRef, useState } from "react";
import { Popover, Slider } from "antd";
import styled from "@emotion/styled";
import { AudioLines, Check, Mic } from "lucide-react";
import {
  defaultMicrophoneReverbStrength,
  type MicrophoneEffect,
} from "@cinegather/contracts";
import { Button } from "./Controls";
import { useApp } from "../store";
import * as actions from "../controller";
import { capabilities } from "../platform";

const Menu = styled.div`
  width: 240px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  .ant-btn {
    min-height: 40px;
    justify-content: flex-start;
    gap: 10px;
  }
  .ant-btn[aria-checked="true"] {
    color: #c4adff;
    background: #c4adff12;
  }
  .effect-check {
    margin-left: auto;
  }
  .effect-strength {
    border-top: 1px solid var(--line);
    margin-top: 8px;
    padding: 12px 8px 0;
  }
  .effect-strength-label {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 12px;
  }
  output {
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .ant-slider {
    margin: 14px 6px 8px;
  }
`;

export function MicrophoneEffectControl({ disabled }: { disabled: boolean }) {
  const effect = useApp((s) => s.settings.microphoneEffect ?? "none");
  const initialStrength = useApp(
    (s) =>
      s.settings.microphoneReverbStrength ?? defaultMicrophoneReverbStrength,
  );
  const [strength, setStrength] = useState(initialStrength);
  const pendingStrength = useRef<number | undefined>(undefined);
  const commitStrength = useCallback(() => {
    const value = pendingStrength.current;
    pendingStrength.current = undefined;
    if (value !== undefined)
      void actions.setMicrophoneReverbStrength(value).catch(actions.report);
  }, []);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const working = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => () => commitStrength(), [commitStrength]);
  disabled ||= !capabilities().microphone;
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      commitStrength();
      setOpen(false);
      trigger.current?.focus();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [open, commitStrength]);
  const select = async (value: MicrophoneEffect) => {
    if (working.current || disabled) return;
    working.current = true;
    setSaving(true);
    try {
      if (value !== effect) await actions.setMicrophoneEffect(value);
      if (value === "none") {
        commitStrength();
        setOpen(false);
        requestAnimationFrame(() => trigger.current?.focus());
      }
    } catch (error) {
      actions.report(error);
    } finally {
      working.current = false;
      setSaving(false);
    }
  };
  return (
    <Popover
      trigger="click"
      placement="top"
      open={open && !disabled}
      onOpenChange={(value) => {
        if (!saving && !disabled) {
          if (!value) commitStrength();
          setOpen(value);
        }
      }}
      content={
        <Menu>
          <div role="menu" aria-label="麦克风音效">
            {(["none", "ktv"] as const).map((value) => (
              <Button
                key={value}
                type="text"
                block
                role="menuitemradio"
                aria-checked={effect === value}
                disabled={saving || disabled}
                onClick={() => void select(value)}
              >
                {value === "none" ? (
                  <Mic size={17} />
                ) : (
                  <AudioLines size={17} />
                )}
                <span>{value === "none" ? "原声" : "KTV 混响"}</span>
                {effect === value && (
                  <Check size={16} className="effect-check" />
                )}
              </Button>
            ))}
          </div>
          {effect === "ktv" && (
            <div className="effect-strength">
              <div className="effect-strength-label">
                <span>混响强度</span>
                <output>{strength}%</output>
              </div>
              <Slider
                ariaLabelForHandle="混响强度"
                min={0}
                max={100}
                step={1}
                value={strength}
                disabled={saving || disabled}
                tooltip={{ open: false }}
                onChange={(value) => {
                  setStrength(value);
                  pendingStrength.current = value;
                  actions.media.setMicrophoneReverbStrength(value);
                }}
                onChangeComplete={commitStrength}
              />
            </div>
          )}
        </Menu>
      }
    >
      <Button
        ref={trigger}
        type="text"
        className={`control-button ${effect === "ktv" ? "effect-control-active" : ""}`}
        aria-label="麦克风音效"
        aria-pressed={effect === "ktv"}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-busy={saving}
        disabled={disabled || saving}
      >
        <AudioLines size={21} />
        <span>{effect === "ktv" ? "KTV 混响" : "音效"}</span>
      </Button>
    </Popover>
  );
}
