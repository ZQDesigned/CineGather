import {
  Alert,
  App,
  Badge,
  Button,
  Card,
  Form,
  Input,
  Modal,
  Result,
  Space,
  Statistic,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Descriptions,
} from "antd";
import type { TableColumnsType } from "antd";
import styled from "@emotion/styled";
import { useEffect, useRef, useState } from "react";
import { RefreshCw, Copy } from "lucide-react";
import { unwrap } from "@cinegather/api-client";
import type {
  AdminAudit,
  AdminOverview,
  AdminRoom,
  AdminUser,
} from "@cinegather/contracts";
import { hasAdminAccess, hasAdminPermission } from "@cinegather/contracts";
import { RoleManagement, UserRolesDialog } from "./AdminRoles";
import { api, report, copyText } from "../controller";
import { useApp } from "../store";
const Surface = styled.section`
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 24px 28px;
  overflow: hidden;
  .admin-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  h1 {
    font-size: 24px;
    margin: 0;
  }
  .admin-stats {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 12px;
  }
  .ant-card-body {
    padding: 14px 18px;
  }
  .ant-statistic-content {
    font-size: 25px;
  }
  .admin-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }
  .admin-toolbar .ant-input-search {
    max-width: 300px;
  }
  .ant-tabs-nav {
    margin: 0;
  }
  .admin-table {
    flex: 1;
    min-height: 0;
  }
  .ant-table-wrapper {
    height: 100%;
  }
  .ant-table-cell {
    vertical-align: middle;
  }
  .admin-user-name {
    display: block;
  }
  .admin-muted {
    font-size: 12px;
    color: #9298a9;
  }
  @media (max-width: 1100px) {
    padding: 16px;
    gap: 12px;
    .admin-stats {
      gap: 8px;
    }
    .ant-card-body {
      padding: 10px 12px;
    }
    h1 {
      font-size: 21px;
    }
    .admin-toolbar .ant-input-search {
      max-width: 230px;
    }
  }
`;
const actionNames: Record<string, string> = {
  "admin.user_disable": "停用账号",
  "admin.user_enable": "启用账号",
  "admin.user_revoke_sessions": "撤销登录",
  "admin.room_closed": "关闭房间",
  "admin.share_revoked": "停止共享",
  "admin.role_granted": "授予管理员",
  "admin.role_revoked": "撤销管理员",
  "admin.superadmin_granted": "授予超级管理员",
  "admin.superadmin_revoked": "撤销超级管理员",
  "admin.role_created": "创建角色",
  "admin.role_updated": "更新角色",
  "admin.role_deleted": "删除角色",
  "admin.user_roles_assigned": "分配管理角色",
};
type Operation =
  | { kind: "disable" | "enable" | "revoke-sessions"; user: AdminUser }
  | { kind: "close" | "revoke-share"; room: AdminRoom };
const operationName = (op: Operation) =>
  ({
    disable: "停用账号",
    enable: "启用账号",
    "revoke-sessions": "撤销登录",
    close: "关闭房间",
    "revoke-share": "停止共享",
  })[op.kind];
const date = (value: string) =>
  new Date(value).toLocaleString("zh-CN", { hour12: false });
export function Admin({ onHome }: { onHome: () => void }) {
  const user = useApp((s) => s.user);
  return !hasAdminAccess(user) ? (
    <Result
      status="403"
      title="需要管理员权限"
      subTitle="请使用已授权的管理员账号登录。"
      extra={<Button onClick={onHome}>返回放映厅</Button>}
    />
  ) : (
    <AdminPanel />
  );
}
function AdminPanel() {
  const { message } = App.useApp();
  const user = useApp((s) => s.user);
  const canOverview = hasAdminPermission(user, "overview.read");
  const canUsers = hasAdminPermission(user, "users.read"),
    canManageUsers = hasAdminPermission(user, "users.manage");
  const canRooms = hasAdminPermission(user, "rooms.read"),
    canManageRooms = hasAdminPermission(user, "rooms.manage");
  const canAudit = hasAdminPermission(user, "audit.read"),
    isSuper = !!user?.isSuperAdmin;
  const allowedTabs = [
    ...(canUsers ? [{ key: "users", label: "用户管理" }] : []),
    ...(canRooms ? [{ key: "rooms", label: "房间管理" }] : []),
    ...(canAudit ? [{ key: "audit", label: "操作记录" }] : []),
    ...(isSuper ? [{ key: "roles", label: "角色管理" }] : []),
  ];
  if (!allowedTabs.length && canOverview)
    allowedTabs.push({ key: "overview", label: "概览" });
  const accessKey = JSON.stringify([user?.isSuperAdmin, user?.permissions]);
  const [roleTarget, setRoleTarget] = useState<AdminUser>(),
    [rolesOpen, setRolesOpen] = useState(false);
  const [tab, setTab] = useState("users"),
    [search, setSearch] = useState(""),
    [draft, setDraft] = useState("");
  const activeTab = allowedTabs.some((t) => t.key === tab)
    ? tab
    : (allowedTabs[0]?.key ?? "overview");
  const [page, setPage] = useState(1),
    [pageSize, setPageSize] = useState(20),
    [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState<string>();
  const [overview, setOverview] = useState<AdminOverview>();
  const [accounts, setAccounts] = useState<AdminUser[]>([]),
    [rooms, setRooms] = useState<AdminRoom[]>([]),
    [logs, setLogs] = useState<AdminAudit[]>([]),
    [total, setTotal] = useState(0);
  const [operation, setOperation] = useState<Operation>(),
    [open, setOpen] = useState(false),
    [saving, setSaving] = useState(false);
  const [form] = Form.useForm<{ reason: string }>();
  const tableRef = useRef<HTMLDivElement>(null);
  const [tableHeight, setTableHeight] = useState(220);
  useEffect(() => {
    const el = tableRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) =>
      setTableHeight(Math.max(100, entry!.contentRect.height - 115)),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(undefined);
    const params = { query: { q: search, page, pageSize } };
    async function load() {
      const [summary, result] = await Promise.all([
        canOverview
          ? api.GET("/api/v1/admin/overview").then(unwrap)
          : Promise.resolve(undefined),
        activeTab === "users"
          ? api.GET("/api/v1/admin/users", { params }).then(unwrap)
          : activeTab === "rooms"
            ? api.GET("/api/v1/admin/rooms", { params }).then(unwrap)
            : activeTab === "audit"
              ? api.GET("/api/v1/admin/audit", { params }).then(unwrap)
              : Promise.resolve({ items: [], total: 0 }),
      ]);
      if (!active) return;
      setOverview(summary);
      setTotal(result.total);
      if (activeTab === "users") setAccounts(result.items as AdminUser[]);
      else if (activeTab === "rooms") setRooms(result.items as AdminRoom[]);
      else if (activeTab === "audit") setLogs(result.items as AdminAudit[]);
    }
    void load()
      .catch((e) => {
        if (active) {
          setError(e instanceof Error ? e.message : "无法加载管理数据");
          report(e);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [activeTab, search, page, pageSize, revision, accessKey, canOverview]);
  const confirm = (op: Operation) => {
    form.resetFields();
    setOperation(op);
    setOpen(true);
  };
  async function submit() {
    const { reason } = await form.validateFields();
    if (!operation) return;
    setSaving(true);
    try {
      if ("user" in operation) {
        const options = {
          params: { path: { userId: operation.user.id } },
          body: { reason },
        };
        unwrap(
          await api.POST(
            operation.kind === "disable"
              ? "/api/v1/admin/users/{userId}/disable"
              : operation.kind === "enable"
                ? "/api/v1/admin/users/{userId}/enable"
                : "/api/v1/admin/users/{userId}/revoke-sessions",
            options,
          ),
        );
      } else {
        const options = {
          params: { path: { roomId: operation.room.id } },
          body: { reason },
        };
        unwrap(
          await api.POST(
            operation.kind === "close"
              ? "/api/v1/admin/rooms/{roomId}/close"
              : "/api/v1/admin/rooms/{roomId}/revoke-share",
            options,
          ),
        );
      }
      void message.success(`${operationName(operation)}成功`);
      setOpen(false);
      setRevision((r) => r + 1);
    } catch (e) {
      report(e);
    } finally {
      setSaving(false);
    }
  }
  const userColumns: TableColumnsType<AdminUser> = [
    {
      title: "账号",
      key: "account",
      width: 200,
      ellipsis: true,
      render: (_, u) => (
        <>
          <strong className="admin-user-name">{u.displayName}</strong>
          <span className="admin-muted">
            {u.username}
            <Tooltip title={u.id}>
              <Button
                size="small"
                type="text"
                aria-label="复制用户 ID"
                icon={<Copy size={12} />}
                onClick={() =>
                  void copyText(u.id, "用户 ID 已复制").catch(report)
                }
              />
            </Tooltip>
          </span>
        </>
      ),
    },
    {
      title: "状态",
      key: "status",
      width: 95,
      render: (_, u) => (
        <Tag color={u.disabledAt ? "error" : "success"}>
          {u.disabledAt ? "已停用" : "正常"}
        </Tag>
      ),
    },
    {
      title: "角色",
      key: "roles",
      width: 160,
      render: (_, u) =>
        u.isSuperAdmin ? (
          <Tag color="purple">超级管理员</Tag>
        ) : u.roles.length ? (
          <Tooltip title={u.roles.map((r) => r.name).join("、")}>
            <span>
              {u.roles.slice(0, 2).map((r) => (
                <Tag key={r.id}>{r.name}</Tag>
              ))}
              {u.roles.length > 2 ? `+${u.roles.length - 2}` : null}
            </span>
          </Tooltip>
        ) : (
          "普通用户"
        ),
    },
    { title: "有效登录", dataIndex: "activeSessions", width: 90 },
    { title: "注册时间", dataIndex: "createdAt", width: 175, render: date },
    {
      title: "操作",
      key: "actions",
      width: isSuper ? 270 : 195,
      fixed: "right",
      render: (_, u) => (
        <Space size={0}>
          {isSuper && !u.isSuperAdmin && (
            <Button
              size="small"
              type="link"
              onClick={() => {
                setRoleTarget(u);
                setRolesOpen(true);
              }}
            >
              分配角色
            </Button>
          )}
          {u.isSuperAdmin ? (
            <span className="admin-muted">服务端维护</span>
          ) : !canManageUsers ? null : u.roles.length && !isSuper ? (
            <span className="admin-muted">无权操作</span>
          ) : (
            <>
              <Button
                size="small"
                type="link"
                danger={!u.disabledAt}
                onClick={() =>
                  confirm({
                    kind: u.disabledAt ? "enable" : "disable",
                    user: u,
                  })
                }
              >
                {u.disabledAt ? "启用" : "停用"}
              </Button>
              <Button
                size="small"
                type="link"
                onClick={() => confirm({ kind: "revoke-sessions", user: u })}
              >
                撤销登录
              </Button>
            </>
          )}
        </Space>
      ),
    },
  ];
  const roomColumns: TableColumnsType<AdminRoom> = [
    {
      title: "房间",
      key: "name",
      width: 205,
      ellipsis: true,
      render: (_, r) => (
        <>
          <strong className="admin-user-name">{r.name}</strong>
          <span className="admin-muted">{r.code}</span>
        </>
      ),
    },
    { title: "房主", dataIndex: "ownerName", width: 120, ellipsis: true },
    {
      title: "类型",
      dataIndex: "access",
      width: 90,
      render: (v) => (v === "password" ? "加密房" : "普通房"),
    },
    {
      title: "状态",
      key: "status",
      width: 100,
      render: (_, r) => (
        <Tag
          color={
            r.status === "closed"
              ? "default"
              : r.sharing
                ? "processing"
                : "success"
          }
        >
          {r.status === "closed" ? "已关闭" : r.sharing ? "共享中" : "开放中"}
        </Tag>
      ),
    },
    {
      title: "人数",
      key: "members",
      width: 80,
      render: (_, r) => `${r.memberCount}/${r.maxMembers}`,
    },
    {
      title: "操作",
      key: "actions",
      fixed: "right",
      width: 195,
      render: (_, r) =>
        r.status === "closed" || !canManageRooms ? (
          <span className="admin-muted">
            {r.status === "closed" ? "已结束" : "仅可查看"}
          </span>
        ) : (
          <Space size={0}>
            <Button
              size="small"
              type="link"
              disabled={!r.sharing}
              onClick={() => confirm({ kind: "revoke-share", room: r })}
            >
              停止共享
            </Button>
            <Button
              size="small"
              type="link"
              danger
              onClick={() => confirm({ kind: "close", room: r })}
            >
              关闭房间
            </Button>
          </Space>
        ),
    },
  ];
  const logColumns: TableColumnsType<AdminAudit> = [
    { title: "时间", dataIndex: "createdAt", width: 175, render: date },
    { title: "操作人", dataIndex: "actorName", width: 145, ellipsis: true },
    {
      title: "操作",
      dataIndex: "action",
      width: 110,
      render: (a) => actionNames[a] ?? "管理操作",
    },
    { title: "对象", dataIndex: "targetName", width: 200, ellipsis: true },
    { title: "原因", dataIndex: "reason", width: 230, ellipsis: true },
  ];
  const pagination = {
    current: page,
    pageSize,
    total,
    showSizeChanger: true,
    pageSizeOptions: [10, 20, 50],
    showTotal: (n: number) => `共 ${n} 条`,
    onChange: (p: number, size: number) => {
      setPage(p);
      setPageSize(size);
    },
  };
  return (
    <Surface aria-label="管理后台">
      <div className="admin-heading">
        <h1>管理后台</h1>
        <Space>
          {canOverview && (
            <Badge
              status={overview?.service === "available" ? "success" : "warning"}
              text={
                overview?.service === "available"
                  ? "服务正常"
                  : overview
                    ? "部分服务暂不可用"
                    : "正在检查服务"
              }
            />
          )}
          <Button
            icon={<RefreshCw size={15} />}
            loading={loading}
            onClick={() => setRevision((r) => r + 1)}
          >
            刷新
          </Button>
        </Space>
      </div>
      {error && (
        <Alert
          type="error"
          showIcon
          title={error}
          action={
            <Button size="small" onClick={() => setRevision((r) => r + 1)}>
              重试
            </Button>
          }
        />
      )}
      {canOverview && (
        <div className="admin-stats">
          {[
            ["注册账号", overview?.accounts],
            ["停用账号", overview?.disabledAccounts],
            ["开放房间", overview?.activeRooms],
            ["有效登录", overview?.activeSessions],
          ].map(([title, value]) => (
            <Card key={title}>
              <Statistic title={title} value={value ?? "—"} />
            </Card>
          ))}
        </div>
      )}
      <div className="admin-toolbar">
        <Tabs
          activeKey={activeTab}
          items={allowedTabs}
          onChange={(key) => {
            setTab(key);
            setPage(1);
            setSearch("");
            setDraft("");
          }}
        />
        {activeTab !== "overview" && (
          <Input.Search
            aria-label="搜索管理数据"
            placeholder={
              activeTab === "users"
                ? "搜索用户名或昵称"
                : activeTab === "rooms"
                  ? "搜索房间名或房间号"
                  : activeTab === "roles"
                    ? "搜索角色名称"
                    : "搜索操作人或对象"
            }
            allowClear
            value={draft}
            maxLength={100}
            onChange={(e) => setDraft(e.target.value)}
            onSearch={(value) => {
              setSearch(value.trim());
              setPage(1);
            }}
          />
        )}
      </div>
      <div className="admin-table" ref={tableRef}>
        {activeTab === "roles" ? (
          <RoleManagement
            revision={revision}
            search={search}
            height={tableHeight}
            onChanged={() => setRevision((r) => r + 1)}
          />
        ) : activeTab === "overview" ? (
          <Card title="服务状态">
            <Descriptions
              items={[
                {
                  key: "status",
                  label: "服务",
                  children:
                    overview?.service === "available" ? "正常" : "暂不可用",
                },
                {
                  key: "version",
                  label: "版本",
                  children: overview?.version ?? "—",
                },
              ]}
            />
          </Card>
        ) : activeTab === "users" ? (
          <Table<AdminUser>
            rowKey="id"
            columns={userColumns}
            dataSource={error ? [] : accounts}
            loading={loading}
            pagination={pagination}
            size="small"
            scroll={{ x: isSuper ? 1030 : 950, y: tableHeight }}
          />
        ) : activeTab === "rooms" ? (
          <Table<AdminRoom>
            rowKey="id"
            columns={roomColumns}
            dataSource={error ? [] : rooms}
            loading={loading}
            pagination={pagination}
            size="small"
            scroll={{ x: 810, y: tableHeight }}
          />
        ) : (
          <Table<AdminAudit>
            rowKey="id"
            columns={logColumns}
            dataSource={error ? [] : logs}
            loading={loading}
            pagination={pagination}
            size="small"
            scroll={{ x: 860, y: tableHeight }}
          />
        )}
      </div>
      <UserRolesDialog
        user={roleTarget}
        open={rolesOpen && isSuper}
        onClose={() => setRolesOpen(false)}
        afterClose={() => setRoleTarget(undefined)}
        onChanged={() => setRevision((r) => r + 1)}
      />
      <Modal
        open={open}
        title={operation ? operationName(operation) : "确认操作"}
        okText="确认操作"
        cancelText="取消"
        confirmLoading={saving}
        okButtonProps={{ danger: operation?.kind !== "enable" }}
        cancelButtonProps={{ disabled: saving }}
        closable={!saving}
        mask={{ closable: !saving }}
        onCancel={() => setOpen(false)}
        onOk={() => void submit().catch(() => {})}
        afterClose={() => setOperation(undefined)}
        destroyOnHidden
      >
        {operation && (
          <>
            <p>
              {"user" in operation
                ? `账号：${operation.user.username}`
                : `房间：${operation.room.name} (${operation.room.code})`}
            </p>
            <p>
              {operation.kind === "disable"
                ? "停用后将退出所有设备，并停止该账号的语音和共享。"
                : operation.kind === "enable"
                  ? "启用后可重新登录，之前的登录会话不会恢复。"
                  : operation.kind === "revoke-sessions"
                    ? "所有设备将退出登录，可以使用原密码重新登录。"
                    : operation.kind === "close"
                      ? "所有成员将离开房间，邀请和共享将同时失效。"
                      : "当前共享将停止，房间内的语音保持可用。"}
            </p>
          </>
        )}
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item
            label="操作原因"
            name="reason"
            rules={[
              {
                required: true,
                whitespace: true,
                min: 2,
                max: 200,
                message: "请输入 2–200 字的操作原因",
              },
            ]}
          >
            <Input.TextArea
              autoFocus
              rows={3}
              maxLength={200}
              showCount
              disabled={saving}
            />
          </Form.Item>
        </Form>
      </Modal>
    </Surface>
  );
}
