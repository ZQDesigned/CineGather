import { Button, Dropdown } from "antd";
import { Ellipsis, LogOut, Radio, Settings } from "lucide-react";
import { useRef, useState } from "react";
import * as actions from "../../controller";
import { openSettings } from "../../features/settings/settings-navigation";
import { update, useApp } from "../../store";

export function AccountMenu() {
  const user = useApp((s) => s.user);
  const busy = useApp((s) => s.busy);
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <Dropdown
      trigger={["click"]}
      placement="topRight"
      autoFocus
      open={open}
      onOpenChange={setOpen}
      styles={{ root: { minWidth: 200 } }}
      menu={{
        items: [
          {
            key: "settings",
            icon: <Settings size={16} />,
            label: "设置与设备",
          },
          { key: "diagnostics", icon: <Radio size={16} />, label: "连接诊断" },
          ...(user
            ? [
                { type: "divider" as const },
                {
                  key: "logout",
                  icon: <LogOut size={16} />,
                  label: "退出登录",
                  danger: true,
                  disabled: busy,
                },
              ]
            : []),
        ],
        onClick: ({ key }) => {
          setOpen(false);
          // Dialogs must restore focus to the visible trigger, not a hidden menu item.
          trigger.current?.focus();
          if (key === "settings") openSettings();
          else if (key === "diagnostics") update({ modal: "diagnostics" });
          else if (key === "logout") void actions.run(actions.logout);
        },
      }}
    >
      <Button
        ref={trigger}
        type="text"
        aria-label="账户菜单"
        aria-haspopup="menu"
        aria-expanded={open}
        icon={<Ellipsis size={18} />}
      />
    </Dropdown>
  );
}
