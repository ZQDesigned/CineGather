import { createContext, useContext, useRef, type ReactNode } from "react";
import { Modal } from "antd";
import { useApp, update } from "../store";
import * as actions from "../controller";
export const DialogLifecycle = createContext({
  open: true,
  afterClose: () => {},
});
export const useDialogOpen = () => useContext(DialogLifecycle).open;
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
  const { open, afterClose } = useContext(DialogLifecycle);
  const trigger = useRef(
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  const close = () => {
    if (!open) return;
    if (useApp.getState().modal === "source") void actions.chooseSource();
    else update({ modal: null });
  };
  return (
    <Modal
      open={open}
      className="cinema-dialog"
      centered
      width={wide ? 760 : 480}
      footer={footer}
      onCancel={close}
      afterClose={() => {
        if (!useApp.getState().modal && trigger.current?.isConnected)
          trigger.current.focus();
        afterClose();
      }}
      focusable={{ focusTriggerAfterClose: false }}
      modalRender={(node) => <div inert={!open}>{node}</div>}
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
