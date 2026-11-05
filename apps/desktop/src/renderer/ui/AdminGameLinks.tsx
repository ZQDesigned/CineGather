import {
  Alert,
  App,
  Button,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
} from "antd";
import type { TableColumnsType } from "antd";
import { useEffect, useState } from "react";
import { unwrap } from "@cinegather/api-client";
import {
  hasAdminPermission,
  type AdminGame,
  type AdminGameMember,
} from "@cinegather/contracts";
import { api, report } from "../controller";
import { useApp } from "../store";
import { AdminSessionEvents, adminDate } from "./AdminSessionEvents";
const states: Record<string, string> = {
  starting: "准备中",
  open: "进行中",
  recovering: "重连中",
  ended: "已结束",
  approved: "已加入",
  connecting: "连接中",
  connected: "已连接",
  reconnecting: "重连中",
  left: "已退出",
  removed: "已移除",
};
function GameMembers({
  target,
  onClose,
}: {
  target: AdminGame;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<AdminGameMember[]>([]),
    [page, setPage] = useState(1),
    [total, setTotal] = useState(0),
    [loading, setLoading] = useState(true),
    [error, setError] = useState<string>();
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(undefined);
    void api
      .GET("/api/v1/admin/games/{gameId}/members", {
        params: { path: { gameId: target.id }, query: { page, pageSize: 20 } },
      })
      .then(unwrap)
      .then((r) => {
        if (active) {
          setRows(r.items);
          setTotal(r.total);
        }
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : "无法加载成员");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [target.id, page]);
  const columns: TableColumnsType<AdminGameMember> = [
    {
      title: "成员",
      key: "name",
      render: (_, r) => (
        <>
          {r.displayName}（{r.username}）
        </>
      ),
    },
    {
      title: "身份",
      dataIndex: "role",
      width: 80,
      render: (v) => (v === "host" ? "主机" : "成员"),
    },
    {
      title: "状态",
      key: "state",
      width: 100,
      render: (_, r) => (
        <Tag color={r.active ? "processing" : "default"}>
          {r.active ? (states[r.status] ?? "连接中") : "已离开"}
        </Tag>
      ),
    },
    {
      title: "连接方式",
      dataIndex: "route",
      width: 110,
      render: (v) => (v === "p2p" ? "直连" : v === "relay" ? "中转" : "—"),
    },
    {
      title: "加入时间",
      dataIndex: "createdAt",
      width: 175,
      render: adminDate,
    },
  ];
  return (
    <Modal
      open
      title={`${target.name}的成员`}
      width={800}
      footer={null}
      onCancel={onClose}
    >
      {error && <Alert type="error" title={error} />}
      <Table
        rowKey="id"
        size="small"
        columns={columns}
        dataSource={error ? [] : rows}
        loading={loading}
        scroll={{ x: 700, y: 380 }}
        pagination={{
          current: page,
          total,
          pageSize: 20,
          showSizeChanger: false,
          onChange: setPage,
        }}
      />
    </Modal>
  );
}
export function AdminGameLinks({
  revision,
  height,
}: {
  revision: number;
  height: number;
}) {
  const user = useApp((s) => s.user),
    canManage = hasAdminPermission(user, "games.manage"),
    canAudit = hasAdminPermission(user, "audit.read");
  const { message } = App.useApp();
  const [q, setQ] = useState(""),
    [status, setStatus] = useState<"all" | "active" | "ended">("all"),
    [page, setPage] = useState(1),
    [rows, setRows] = useState<AdminGame[]>([]),
    [total, setTotal] = useState(0),
    [loading, setLoading] = useState(true),
    [error, setError] = useState<string>(),
    [refresh, setRefresh] = useState(0);
  const [members, setMembers] = useState<AdminGame>(),
    [history, setHistory] = useState<AdminGame>(),
    [closing, setClosing] = useState<AdminGame>(),
    [saving, setSaving] = useState(false);
  const [form] = Form.useForm<{ reason: string }>();
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(undefined);
    void api
      .GET("/api/v1/admin/games", {
        params: { query: { q, status, page, pageSize: 20 } },
      })
      .then(unwrap)
      .then((r) => {
        if (active) {
          setRows(r.items);
          setTotal(r.total);
        }
      })
      .catch((e) => {
        if (active)
          setError(e instanceof Error ? e.message : "无法加载联机数据");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [q, status, page, revision, refresh]);
  async function close() {
    const { reason } = await form.validateFields();
    if (!closing) return;
    setSaving(true);
    try {
      unwrap(
        await api.POST("/api/v1/admin/games/{gameId}/close", {
          params: { path: { gameId: closing.id } },
          body: { reason: reason.trim() },
        }),
      );
      setClosing(undefined);
      setRefresh((r) => r + 1);
      void message.success("已结束联机");
    } catch (e) {
      report(e);
    } finally {
      setSaving(false);
    }
  }
  const columns: TableColumnsType<AdminGame> = [
    {
      title: "联机",
      key: "name",
      width: 180,
      ellipsis: true,
      render: (_, r) => (
        <>
          <strong className="admin-user-name">{r.name}</strong>
          <span className="admin-muted">{r.code}</span>
        </>
      ),
    },
    {
      title: "主机",
      key: "host",
      width: 190,
      ellipsis: true,
      render: (_, r) => `${r.hostName}（${r.hostUsername}）`,
    },
    {
      title: "游戏",
      key: "game",
      width: 150,
      render: (_, r) => (
        <>
          Minecraft Java 版
          {r.gameVersion && <div className="admin-muted">{r.gameVersion}</div>}
        </>
      ),
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 85,
      render: (v) => (
        <Tag color={v === "ended" ? "default" : "processing"}>{states[v]}</Tag>
      ),
    },
    {
      title: "人数",
      key: "count",
      width: 75,
      render: (_, r) => `${r.memberCount}/${r.maxMembers}`,
    },
    {
      title: "开始时间",
      dataIndex: "createdAt",
      width: 175,
      render: adminDate,
    },
    {
      title: "结束时间",
      dataIndex: "endedAt",
      width: 175,
      render: (v) => (v ? adminDate(v) : "—"),
    },
    {
      title: "操作",
      key: "actions",
      width: 225,
      fixed: "right",
      render: (_, r) => (
        <Space size={0}>
          <Button type="link" size="small" onClick={() => setMembers(r)}>
            成员
          </Button>
          {canAudit && (
            <Button type="link" size="small" onClick={() => setHistory(r)}>
              事件记录
            </Button>
          )}
          {canManage && r.status !== "ended" && (
            <Button
              type="link"
              size="small"
              danger
              onClick={() => {
                form.resetFields();
                setClosing(r);
              }}
            >
              结束联机
            </Button>
          )}
        </Space>
      ),
    },
  ];
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        height: "100%",
      }}
    >
      <Space>
        <Input.Search
          aria-label="搜索游戏联机"
          placeholder="搜索联机名、联机码或主机"
          allowClear
          maxLength={100}
          onSearch={(v) => {
            setQ(v.trim());
            setPage(1);
          }}
        />
        <Select
          aria-label="联机状态"
          value={status}
          style={{ width: 130 }}
          options={[
            { value: "all", label: "全部状态" },
            { value: "active", label: "进行中" },
            { value: "ended", label: "已结束" },
          ]}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
        />
      </Space>
      {error && <Alert type="error" title={error} />}
      <Table
        rowKey="id"
        size="small"
        columns={columns}
        dataSource={error ? [] : rows}
        loading={loading}
        scroll={{ x: 1255, y: Math.max(100, height - 48) }}
        pagination={{
          current: page,
          pageSize: 20,
          total,
          showSizeChanger: false,
          onChange: setPage,
          showTotal: (n) => `共 ${n} 条`,
        }}
      />
      {members && (
        <GameMembers
          key={members.id}
          target={members}
          onClose={() => setMembers(undefined)}
        />
      )}{" "}
      {history && (
        <AdminSessionEvents
          key={history.id}
          kind="game"
          target={history}
          onClose={() => setHistory(undefined)}
        />
      )}
      <Modal
        open={!!closing}
        title="结束游戏联机"
        okText="结束联机"
        okButtonProps={{ danger: true }}
        confirmLoading={saving}
        onOk={() => void close()}
        onCancel={() => {
          if (!saving) setClosing(undefined);
        }}
      >
        <p>结束「{closing?.name}」后，所有成员的游戏连接将断开。</p>
        <Form form={form} layout="vertical">
          <Form.Item
            name="reason"
            label="操作原因"
            rules={[
              { required: true, whitespace: true, message: "请填写操作原因" },
              { max: 200, message: "操作原因最多 200 字" },
            ]}
          >
            <Input.TextArea rows={3} maxLength={200} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
