import type { RetainedDialogProps } from "../../../ui/useRetainedDialog";
import { Alert, Input, Modal, Space, Table } from "antd";
import type { TableColumnsType } from "antd";
import { useEffect, useState } from "react";
import { unwrap } from "@cinegather/api-client";
import type { AdminSessionEvent } from "@cinegather/contracts";
import { api } from "../../../controller";
export const adminDate = (v: string) =>
  new Date(v).toLocaleString("zh-CN", { hour12: false });
const actions: Record<string, string> = {
  "room.created": "创建房间",
  "room.updated": "修改房间",
  "room.joined": "加入房间",
  "room.left": "退出房间",
  "room.device_replaced": "切换入房设备",
  "room.closed_empty": "空房关闭",
  "room.owner_transferred": "转移房主",
  "member.kicked": "踢出成员",
  "member.banned": "封禁成员",
  "member.unbanned": "解除封禁",
  "member.microphone_muted": "关闭成员麦克风",
  "member.accompaniment_stopped": "停止成员伴奏",
  "member.permissions_updated": "修改成员权限",
  "share.granted": "开始共享",
  "share.released": "停止共享",
  "share.stopped": "房主停止共享",
  "share.reconciled": "清理已结束的共享",
  "invite.created": "创建邀请",
  "invite.revoked": "撤销邀请",
  "friend.room_invited": "邀请好友入房",
  "friend.room_requested": "申请入房",
  "friend.room_request_approved": "同意入房申请",
  "friend.room_request_rejected": "拒绝入房申请",
  "admin.room_closed": "管理员关闭房间",
  "admin.share_revoked": "管理员停止共享",
  "game.created": "发起联机",
  "game.ready": "世界已就绪",
  "game.join_requested": "申请加入",
  "game.request_approved": "同意加入申请",
  "game.request_rejected": "拒绝加入申请",
  "game.invited": "邀请好友",
  "game.invite_accepted": "接受邀请",
  "game.member_joined": "加入联机",
  "game.member_left": "退出联机",
  "game.member_removed": "移除成员",
  "game.member_disconnected": "成员断线",
  "game.member_reconnected": "成员重连",
  "game.member_expired": "成员超时离开",
  "game.ended": "结束联机",
  "admin.game_closed": "管理员结束联机",
  "esports.configuration_updated": "修改赛事配置",
  "esports.seat_changed": "调整席位",
  "esports.watch_changed": "切换观看选手",
  "esports.share_started": "开始选手共享",
  "esports.pause_started": "开始战术暂停",
  "esports.pause_ended": "结束战术暂停",
  "esports.pause_expired": "战术暂停到期",
  "esports.coach_voice_changed": "调整教练发言权限",
  "share.stopped_by_owner": "房主停止共享",
  "esports.seat_updated": "调整席位",
  "esports.config_updated": "修改赛事配置",
  "esports.tactical_pause": "调整战术暂停",
  "esports.coach_voice": "调整教练发言权限",
};
const reasons: Record<string, string> = {
  host_ended: "主机结束联机",
  host_unavailable: "主机离线超时",
  credential_revoked: "登录设备已退出",
  lease_expired: "连接中断",
  connection_expired: "重连超时",
  admin_closed: "管理员结束联机",
};
export function AdminSessionEvents({
  kind,
  target,
  open,
  afterClose,
  onClose,
}: {
  kind: "room" | "game";
  target: { id: string; name: string };
  onClose: () => void;
} & RetainedDialogProps) {
  const [page, setPage] = useState(1),
    [q, setQ] = useState(""),
    [rows, setRows] = useState<AdminSessionEvent[]>([]),
    [total, setTotal] = useState(0),
    [loading, setLoading] = useState(false),
    [error, setError] = useState<string>();
  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setError(undefined);
    const result =
      kind === "game"
        ? api.GET("/api/v1/admin/games/{gameId}/events", {
            params: {
              path: { gameId: target.id },
              query: { q, page, pageSize: 20 },
            },
          })
        : api.GET("/api/v1/admin/rooms/{roomId}/events", {
            params: {
              path: { roomId: target.id },
              query: { q, page, pageSize: 20 },
            },
          });
    void result
      .then(unwrap)
      .then((data) => {
        if (active) {
          setRows(data.items);
          setTotal(data.total);
        }
      })
      .catch((e) => {
        if (active)
          setError(e instanceof Error ? e.message : "无法加载事件记录");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [kind, target.id, page, q, open]);
  const columns: TableColumnsType<AdminSessionEvent> = [
    { title: "时间", dataIndex: "createdAt", width: 175, render: adminDate },
    { title: "操作人", dataIndex: "actorName", width: 120, ellipsis: true },
    {
      title: "事件",
      dataIndex: "action",
      width: 170,
      render: (a) => actions[a] ?? "房间活动",
    },
    {
      title: "相关成员",
      dataIndex: "memberName",
      width: 120,
      render: (v) => v || "—",
      ellipsis: true,
    },
    {
      title: "原因",
      dataIndex: "reason",
      width: 190,
      render: (v) => reasons[v] ?? (v || "—"),
    },
  ];
  return (
    <Modal
      open={open}
      afterClose={afterClose}
      destroyOnHidden
      title={`${target.name}的事件记录`}
      width={900}
      footer={null}
      onCancel={onClose}
    >
      <Space orientation="vertical" style={{ width: "100%" }} size={16}>
        <Input.Search
          aria-label="搜索事件记录"
          placeholder="搜索操作人、成员或原因"
          allowClear
          maxLength={100}
          onSearch={(v) => {
            setQ(v.trim());
            setPage(1);
          }}
        />
        {error && <Alert type="error" title={error} />}
        <Table
          rowKey="id"
          size="small"
          columns={columns}
          loading={loading}
          dataSource={error ? [] : rows}
          scroll={{ x: 775, y: 380 }}
          pagination={{
            current: page,
            total,
            pageSize: 20,
            showSizeChanger: false,
            onChange: setPage,
            showTotal: (n) => `共 ${n} 条`,
          }}
        />
      </Space>
    </Modal>
  );
}
