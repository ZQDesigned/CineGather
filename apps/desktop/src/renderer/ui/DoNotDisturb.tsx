import { useState } from "react";
import { Button } from "antd";
import { Moon } from "lucide-react";
import { useApp } from "../store";
import { report, setDoNotDisturb } from "../controller";
export function DoNotDisturb() {
  const enabled = useApp((s) =>
    Boolean(s.settings.notifications?.doNotDisturb),
  );
  const [pending, setPending] = useState(false);
  return (
    <Button
      size="small"
      type={enabled ? "primary" : "text"}
      icon={<Moon size={15} />}
      aria-label={enabled ? "关闭免打扰" : "开启免打扰"}
      aria-pressed={enabled}
      loading={pending}
      style={{ minWidth: 92 }}
      onClick={() => {
        setPending(true);
        void setDoNotDisturb(!enabled)
          .catch(report)
          .finally(() => setPending(false));
      }}
    >
      {enabled ? "免打扰中" : "免打扰"}
    </Button>
  );
}
