import { Button, App } from "antd";
import { Keyboard } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { displayShortcut, recordedShortcut } from "../../shared/shortcuts";
import { capabilities } from "../platform";

function browserRecording(signal: AbortSignal): Promise<string | undefined> {
  return new Promise((resolve) => {
    let candidate: { code: string; value: string } | undefined;
    const finish = (value?: string) => {
      clearTimeout(timer);
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("keyup", up, true);
      window.removeEventListener("blur", cancel);
      signal.removeEventListener("abort", cancel);
      resolve(value);
    };
    const cancel = () => finish();
    const down = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.code === "Escape") return finish();
      const value = recordedShortcut({
        code: e.code,
        control: e.ctrlKey,
        meta: e.metaKey,
        alt: e.altKey,
        shift: e.shiftKey,
        isComposing: e.isComposing,
        isAutoRepeat: e.repeat,
      });
      if (value) candidate = { code: e.code, value };
    };
    const up = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (candidate?.code === e.code) finish(candidate.value);
    };
    const timer = setTimeout(cancel, 30_000);
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    window.addEventListener("blur", cancel);
    signal.addEventListener("abort", cancel, { once: true });
  });
}

export function ShortcutRecorder({
  label,
  value,
  onChange,
  active,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  active: boolean;
}) {
  const [recording, setRecording] = useState(false);
  const pending = useRef<AbortController | undefined>(undefined);
  const { message } = App.useApp();
  const cancel = () => {
    pending.current?.abort();
    pending.current = undefined;
  };
  useEffect(() => {
    if (!active) {
      cancel();
      setRecording(false);
    }
    return cancel;
  }, [active]);
  const record = async () => {
    if (pending.current) {
      cancel();
      setRecording(false);
      return;
    }
    const controller = new AbortController();
    pending.current = controller;
    setRecording(true);
    try {
      const native = window.desktop?.recordShortcut;
      if (native)
        controller.signal.addEventListener(
          "abort",
          () => {
            void window.desktop?.cancelShortcutRecording?.();
          },
          { once: true },
        );
      const captured = native
        ? await native()
        : await browserRecording(controller.signal);
      if (!controller.signal.aborted && captured) onChange(captured);
    } catch (error) {
      if (!controller.signal.aborted)
        void message.error(
          error instanceof Error ? error.message : "无法录入快捷键",
        );
    } finally {
      if (pending.current === controller) {
        pending.current = undefined;
        setRecording(false);
      }
    }
  };
  return (
    <Button
      aria-label={label}
      aria-pressed={recording}
      className={`shortcut-recorder ${recording ? "recording" : ""}`}
      onClick={() => void record()}
      onBlur={() => {
        cancel();
        setRecording(false);
      }}
    >
      <span>
        {recording
          ? "请按组合键，Esc 取消"
          : displayShortcut(value, capabilities().platform)}
      </span>
      <Keyboard size={16} />
    </Button>
  );
}
