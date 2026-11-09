import { useEffect, useRef } from "react";
import { App, Button } from "antd";
import type { PointsSummary } from "@cinegather/contracts";
import { nextPointsFeedback, pointsReason } from "@cinegather/client-core";
import { useApp } from "../../../store";
export function useRoomPoints(summary: PointsSummary | undefined) {
  const userId = useApp((s) => s.user?.id),
    previous = useRef<{ userId?: string; summary?: PointsSummary }>({}),
    { notification } = App.useApp();
  useEffect(() => {
    if (!summary) return;
    const before =
      previous.current.userId === userId ? previous.current.summary : undefined;
    const award = nextPointsFeedback(before, summary);
    if (
      !before ||
      (summary.latest?.sequence ?? 0) >= (before.latest?.sequence ?? 0)
    )
      previous.current = { userId, summary };
    if (!award) return;
    notification[award.amount ? "success" : "info"]({
      key: "points-award",
      title: award.amount ? `获得 +${award.amount} 积分` : "今日积分已达上限",
      description: award.amount
        ? `${pointsReason(award)}${award.outcome === "capped" ? "，已按今日剩余额度结算" : ""}`
        : "继续游戏不影响投稿资格统计。",
      actions: award.amount ? (
        <Button
          size="small"
          onClick={() => {
            location.hash = "/points";
            notification.destroy("points-award");
          }}
        >
          查看积分
        </Button>
      ) : undefined,
      duration: 5,
    });
  }, [summary, userId, notification]);
}
