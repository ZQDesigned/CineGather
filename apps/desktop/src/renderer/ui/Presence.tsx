import { Avatar, Badge, Button, Dropdown } from "antd";
import { useApp } from "../store";
import * as actions from "../controller";

export function PresenceAvatar() {
  const user = useApp((s) => s.user);
  const visibility = useApp((s) => s.presenceVisibility);
  if (!user) return <Avatar className="purple">映</Avatar>;
  return (
    <Dropdown
      trigger={["click"]}
      menu={{
        selectable: true,
        selectedKeys: visibility ? [visibility] : [],
        items: [
          { key: "online", label: "在线" },
          { key: "invisible", label: "隐身" },
        ],
        onClick: ({ key }) => {
          if (key === "online" || key === "invisible")
            void actions.run(() => actions.setPresence(key));
        },
      }}
    >
      <Button
        type="text"
        aria-label="设置在线状态"
        title={
          visibility === "invisible"
            ? "隐身，点击切换状态"
            : visibility === "online"
              ? "在线，点击切换状态"
              : "正在连接，点击设置状态"
        }
        style={{ padding: 0, height: 40, flexShrink: 0 }}
      >
        <Badge
          dot
          color={visibility === "online" ? "#75c99c" : "#8e93a4"}
          offset={[-3, 35]}
        >
          <Avatar className="purple">{user.displayName[0]}</Avatar>
        </Badge>
      </Button>
    </Dropdown>
  );
}
