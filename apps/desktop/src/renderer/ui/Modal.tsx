import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { useApp, update } from "../store";
import * as actions from "../controller";
export function ModalShell({
  title,
  subtitle,
  children,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const close = () => {
    if (useApp.getState().modal === "source") void actions.chooseSource();
    else update({ modal: null });
  };
  useEffect(() => {
    const el = ref.current!;
    el.showModal();
    return () => {
      el.close();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`dialog ${wide ? "wide-dialog" : ""}`}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div className="dialog-inner">
        <header className="dialog-header">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button
            className="icon-button"
            aria-label="关闭对话框"
            onClick={close}
          >
            <X size={20} />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}
