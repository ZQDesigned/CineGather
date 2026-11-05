import { Button, Popconfirm, Space } from "antd";
import { Gamepad2, LogOut } from "lucide-react";
import { useApp } from "../store";
import { gameLink } from "../game-link";
import * as actions from "../controller";

export function GameLinkStatus({ onReturn }: { onReturn(): void }) {
  const { game, busy } = useApp();
  const { session, self } = game.snapshot;
  if (!window.desktop?.gameLink || !session || !self) return null;
  const host = self.role === "host";
  return (
    <Space.Compact
      className="current-room current-game"
      role="group"
      aria-label="当前游戏联机"
      size="small"
    >
      <Button
        className="current-room-link"
        icon={<Gamepad2 size={14} />}
        aria-label="返回当前联机"
        disabled={busy}
        onClick={onReturn}
      >
        <span className="current-room-name">{session.name}</span>
        <span className="current-game-count">
          {session.memberCount}/{session.maxMembers}
        </span>
      </Button>
      <Popconfirm
        title={host ? "结束此次游戏联机？" : "退出此次游戏联机？"}
        description={host ? "所有玩家的联机连接将断开。" : undefined}
        onConfirm={() => actions.run(() => gameLink.exit())}
      >
        <Button
          danger
          className="current-room-exit"
          icon={<LogOut size={14} />}
          aria-label={host ? "结束当前联机" : "退出当前联机"}
          disabled={busy}
        >
          {host ? "结束" : "退出"}
        </Button>
      </Popconfirm>
    </Space.Compact>
  );
}
