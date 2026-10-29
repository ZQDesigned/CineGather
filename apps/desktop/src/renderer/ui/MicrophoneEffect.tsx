import { useEffect, useRef, useState } from "react";
import { Popover } from "antd";
import styled from "@emotion/styled";
import { AudioLines, Check, Mic } from "lucide-react";
import type { MicrophoneEffect } from "@cinegather/contracts";
import { Button } from "./Controls";
import { useApp } from "../store";
import * as actions from "../controller";
import { capabilities } from "../platform";

const Menu = styled.div`
  width: 200px;
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
`;

export function MicrophoneEffectControl({ disabled }: { disabled: boolean }) {
  const effect = useApp((s) => s.settings.microphoneEffect ?? "none");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const working = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);
  disabled ||= !capabilities().microphone;
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [open]);
  const select = async (value: MicrophoneEffect) => {
    if (working.current || disabled) return;
    working.current = true;
    setSaving(true);
    try {
      if (value !== effect) await actions.setMicrophoneEffect(value);
      setOpen(false);
      requestAnimationFrame(() => trigger.current?.focus());
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
        if (!saving && !disabled) setOpen(value);
      }}
      content={
        <Menu role="menu" aria-label="麦克风音效">
          {(["none", "ktv"] as const).map((value) => (
            <Button
              key={value}
              type="text"
              role="menuitemradio"
              aria-checked={effect === value}
              disabled={saving || disabled}
              onClick={() => void select(value)}
            >
              {value === "none" ? <Mic size={17} /> : <AudioLines size={17} />}
              <span>{value === "none" ? "原声" : "KTV 混响"}</span>
              {effect === value && <Check size={16} className="effect-check" />}
            </Button>
          ))}
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
