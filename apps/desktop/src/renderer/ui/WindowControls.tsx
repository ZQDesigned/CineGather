import { Button, Tooltip } from "antd";
import { Copy, Minus, Square, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { MainWindowAction } from "@cinegather/contracts";
import { report } from "../controller";

export function WindowControls() {
  const controls =
    window.desktop?.platform === "win32"
      ? window.desktop.windowControls
      : undefined;
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    if (!controls) return;
    let active = true;
    let receivedEvent = false;
    const unsubscribe = controls.onState((state) => {
      receivedEvent = true;
      if (active) setMaximized(state.maximized);
    });
    void controls
      .state()
      .then((state) => {
        if (active && !receivedEvent) setMaximized(state.maximized);
      })
      .catch((error: unknown) => {
        if (active) report(error);
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [controls]);
  if (!controls) return null;
  const run = (action: MainWindowAction) =>
    void controls.action(action).catch(report);
  const maximizeLabel = maximized ? "还原窗口" : "最大化";
  return (
    <div
      className="window-controls"
      role="group"
      aria-label="窗口控制"
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <Tooltip title="最小化">
        <Button
          type="text"
          aria-label="最小化"
          icon={<Minus size={16} />}
          onClick={() => run("minimize")}
        />
      </Tooltip>
      <Tooltip title={maximizeLabel}>
        <Button
          type="text"
          aria-label={maximizeLabel}
          icon={maximized ? <Copy size={14} /> : <Square size={14} />}
          onClick={() => run("toggle-maximize")}
        />
      </Tooltip>
      <Tooltip title="关闭窗口">
        <Button
          type="text"
          className="window-close"
          aria-label="关闭窗口"
          icon={<X size={17} />}
          onClick={() => run("close")}
        />
      </Tooltip>
    </div>
  );
}
