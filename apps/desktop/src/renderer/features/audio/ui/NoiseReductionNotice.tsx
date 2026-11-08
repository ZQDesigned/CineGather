import {
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type RefObject,
} from "react";
import { Button, Popover } from "antd";
import styled from "@emotion/styled";
import { useApp } from "../../../store";
import * as actions from "../../../controller";

const Content = styled.div`
  width: 280px;
  max-width: calc(100vw - 48px);
  display: flex;
  flex-direction: column;
  gap: 12px;
  p {
    margin: 0;
    line-height: 1.7;
  }
  .ant-btn {
    align-self: flex-end;
  }
`;

function dialogVisible() {
  return [...document.querySelectorAll('[role="dialog"]')].some(
    (dialog) => dialog.getClientRects().length > 0,
  );
}

export function NoiseReductionNotice({
  children,
  disabled,
  triggerRef,
}: {
  children: ReactElement;
  disabled: boolean;
  triggerRef: RefObject<HTMLButtonElement | null>;
}) {
  const pending = useApp((s) => s.settings.noiseReductionNoticePending);
  const mode = useApp((s) => s.settings.noiseReduction);
  const blocked = useApp((s) => Boolean(s.modal));
  const shown = useRef(false);
  const restoreFocus = useRef(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (disabled || blocked || !pending || mode !== "basic" || shown.current)
      return;
    const show = () => {
      if (document.hidden || shown.current || dialogVisible()) return;
      shown.current = true;
      setOpen(true);
      // Consume when displayed, so leaving the room or restarting without
      // dismissing this hint cannot show it a second time.
      void actions.acknowledgeNoiseReductionNotice().catch(actions.report);
    };
    // Modal state is cleared before its exit finishes. Wait for the retained
    // dialog to leave the DOM, rather than overlapping its focus trap.
    const dialogs = new MutationObserver(show);
    dialogs.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style", "class"],
    });
    show();
    document.addEventListener("visibilitychange", show);
    return () => {
      dialogs.disconnect();
      document.removeEventListener("visibilitychange", show);
    };
  }, [disabled, blocked, pending, mode]);

  useEffect(() => {
    if (disabled || blocked) setOpen(false);
  }, [disabled, blocked]);

  const close = (focus = false) => {
    if (focus) restoreFocus.current = true;
    setOpen(false);
  };
  useEffect(() => {
    if (!open || disabled || blocked) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      restoreFocus.current = true;
      setOpen(false);
    };
    window.addEventListener("keydown", escape, true);
    return () => window.removeEventListener("keydown", escape, true);
  }, [open, disabled, blocked]);

  return (
    <Popover
      open={open}
      trigger="click"
      placement="topLeft"
      destroyOnHidden={false}
      afterOpenChange={(visible) => {
        if (visible || !restoreFocus.current) return;
        restoreFocus.current = false;
        if (!disabled && !blocked) triggerRef.current?.focus();
      }}
      onOpenChange={(value) => {
        if (!value) close();
      }}
      title="降噪设置已调整"
      content={
        <Content role="region" aria-label="降噪设置调整提示" aria-live="polite">
          <p>
            为避免增强降噪在部分设备上过度抑制人声，已切换为基础降噪。你可以在此菜单手动切回增强降噪。
          </p>
          <Button size="small" type="primary" onClick={() => close(true)}>
            知道了
          </Button>
        </Content>
      }
    >
      <span style={{ display: "inline-flex" }}>{children}</span>
    </Popover>
  );
}
