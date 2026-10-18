import { X } from "lucide-react";
import { useApp, update } from "../store";

export function MessageBanner() {
  const error = useApp((state) => state.error);
  const notice = useApp((state) => state.notice);
  if (!error && !notice) return null;
  return (
    <div
      className={`toast ${error ? "error" : ""}`}
      role={error ? "alert" : "status"}
    >
      <span>{error ?? notice}</span>
      <button
        aria-label="关闭提示"
        className="icon-button"
        onClick={() => update({ error: undefined, notice: undefined })}
      >
        <X size={16} />
      </button>
    </div>
  );
}
