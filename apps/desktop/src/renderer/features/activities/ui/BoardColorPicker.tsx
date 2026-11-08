import { useEffect, useRef, useState } from "react";
import { ColorPicker, type GetRef } from "antd";
import { Button } from "../../rooms/ui/Controls";
export function BoardColorPicker({
  value,
  onChange,
  workspace,
}: {
  value: string;
  onChange(value: string): void;
  workspace: boolean;
}) {
  const [open, setOpen] = useState(false),
    trigger = useRef<GetRef<typeof Button>>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("keydown", close, true);
    return () => document.removeEventListener("keydown", close, true);
  }, [open]);
  return (
    <ColorPicker
      value={value}
      open={open}
      onOpenChange={setOpen}
      disabledAlpha
      disabledFormat
      format="hex"
      mode="single"
      placement={workspace ? "rightTop" : "topLeft"}
      destroyOnHidden
      onChange={(color) => onChange(color.toHexString())}
      panelRender={(panel) => (
        <section role="dialog" aria-label="画笔颜色选择器">
          {panel}
        </section>
      )}
    >
      <Button
        ref={trigger}
        aria-label="画笔颜色"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span
          className="board-color-swatch"
          aria-hidden
          style={{
            display: "block",
            width: 18,
            height: 18,
            borderRadius: 4,
            backgroundColor: value,
            border: "1px solid #ffffff40",
          }}
        />
      </Button>
    </ColorPicker>
  );
}
