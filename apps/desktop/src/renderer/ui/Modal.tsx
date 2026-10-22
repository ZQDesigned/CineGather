import { useEffect, useRef, type ReactNode } from "react";
import { Modal } from "antd";
import { useApp, update } from "../store";
import * as actions from "../controller";
export function ModalShell({
  title,
  subtitle,
  children,
  wide = false,
  footer = null,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  wide?: boolean;
  footer?: ReactNode;
}) {
  const trigger = useRef(
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  const restoreFrame = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (restoreFrame.current !== undefined)
      cancelAnimationFrame(restoreFrame.current);
    return () => {
      restoreFrame.current = requestAnimationFrame(() => {
        if (trigger.current?.isConnected) trigger.current.focus();
      });
    };
  }, []);
  const close = () => {
    if (useApp.getState().modal === "source") void actions.chooseSource();
    else update({ modal: null });
  };
  return (
    <Modal
      open
      className="cinema-dialog"
      centered
      width={wide ? 760 : 480}
      footer={footer}
      onCancel={close}
      destroyOnHidden
      getContainer={false}
      closable={{ "aria-label": "关闭对话框" }}
      title={
        <div className="dialog-header">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
        </div>
      }
    >
      <div className="dialog-inner">{children}</div>
    </Modal>
  );
}
