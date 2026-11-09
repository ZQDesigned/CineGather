import { Descriptions, Drawer, Tag, Typography } from "antd";
import type { PointsEntry, AdminPointsEntry } from "@cinegather/contracts";
import { pointsGameName, pointsReason } from "@cinegather/client-core";
import { useRetainedDialog } from "../../../ui/useRetainedDialog";
export function PointsDetail({
  entry,
  onClose,
}: {
  entry: PointsEntry | AdminPointsEntry | undefined;
  onClose(): void;
}) {
  const retained = useRetainedDialog(entry),
    shown = retained.value;
  const admin = shown && "userId" in shown ? shown : undefined;
  return (
    <Drawer
      title="积分明细"
      open={retained.open}
      onClose={onClose}
      afterOpenChange={(open) => {
        if (!open) retained.afterClose();
      }}
      size={460}
    >
      {shown && (
        <>
          <Typography.Title
            level={2}
            style={{ color: shown.amount ? "#a4d4b5" : undefined }}
          >
            +{shown.amount} 积分
          </Typography.Title>
          <Tag>{pointsGameName(shown.game)}</Tag>
          <Descriptions
            column={1}
            style={{ marginTop: 24 }}
            items={[
              {
                key: "reason",
                label: "积分来源",
                children: pointsReason(shown),
              },
              {
                key: "time",
                label: "时间",
                children: new Date(shown.createdAt).toLocaleString(),
              },
              { key: "expected", label: "本次奖励", children: shown.expected },
              { key: "actual", label: "实际到账", children: shown.amount },
              { key: "before", label: "结算前余额", children: shown.before },
              { key: "after", label: "结算后余额", children: shown.after },
              ...(shown.outcome === "capped"
                ? [
                    {
                      key: "cap",
                      label: "额度说明",
                      children: "已按当日剩余额度结算",
                    },
                  ]
                : []),
              ...(admin
                ? [
                    {
                      key: "facts",
                      label: "结算依据",
                      children: (
                        <Typography.Paragraph
                          style={{
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-all",
                            margin: 0,
                          }}
                        >
                          {JSON.stringify(admin.facts, null, 2)}
                        </Typography.Paragraph>
                      ),
                    },
                    {
                      key: "user",
                      label: "用户",
                      children: `${admin.displayName}（${admin.username ?? "已注销"}）`,
                    },
                    {
                      key: "policy",
                      label: "奖励规则版本",
                      children: admin.policyVersion,
                    },
                    {
                      key: "settlementPolicy",
                      label: "结算规则版本",
                      children: admin.settlementPolicyVersion,
                    },
                    {
                      key: "limit",
                      label: "结算日上限",
                      children: admin.appliedCap,
                    },
                    ...(
                      [
                        "id",
                        "roomId",
                        "matchId",
                        "roundId",
                        "traceId",
                        "previousHash",
                        "entryHash",
                      ] as const
                    ).map((key) => ({
                      key,
                      label: {
                        id: "流水号",
                        roomId: "房间",
                        matchId: "对局",
                        roundId: "轮次",
                        traceId: "关联记录",
                        previousHash: "前笔摘要",
                        entryHash: "本笔摘要",
                      }[key],
                      children: (
                        <Typography.Text
                          copyable
                          style={{ wordBreak: "break-all" }}
                        >
                          {admin[key]}
                        </Typography.Text>
                      ),
                    })),
                  ]
                : []),
            ]}
          />
        </>
      )}
    </Drawer>
  );
}
