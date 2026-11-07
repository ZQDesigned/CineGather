import { Button } from "antd";
import { Gamepad2 } from "lucide-react";
import { unwrap } from "@cinegather/api-client";
import type { Friend } from "../friends";
import { useApp, update } from "../../../store";
import * as actions from "../../../controller";
import { gameLink } from "../../games/game-link";

export function FriendGameJoinButton({ friend }: { friend: Friend }) {
  const busy = useApp((s) => s.busy),
    current = useApp((s) => s.game.snapshot.self);
  if (friend.status !== "accepted" || !friend.online || !friend.game)
    return null;
  const game = friend.game,
    full = game.memberCount >= game.maxMembers,
    desktop = !!window.desktop?.gameLink;
  return (
    <Button
      icon={<Gamepad2 size={16} />}
      disabled={
        busy ||
        (desktop &&
          (!!current ||
            game.joined ||
            game.requestPending ||
            !game.joinable ||
            full))
      }
      onClick={() => {
        if (!desktop) {
          update({ modal: "download" });
          return;
        }
        void actions.run(async () => {
          unwrap(
            await actions.api.POST("/api/v1/friends/{userId}/game-requests", {
              params: { path: { userId: friend.userId } },
            }),
          );
          await Promise.all([actions.refreshFriends(), gameLink.refresh()]);
          update({ notice: "申请已发送，等待主机同意" });
        });
      }}
    >
      {!desktop
        ? "使用客户端联机"
        : game.joined
          ? "已在同一联机"
          : current
            ? "已在游戏联机"
            : game.requestPending
              ? "等待主机同意"
              : full
                ? "联机已满"
                : "申请联机"}
    </Button>
  );
}
