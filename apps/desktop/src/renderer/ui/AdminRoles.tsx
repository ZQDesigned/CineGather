import {
  Alert,
  Button,
  Checkbox,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  App,
} from "antd";
import type { TableColumnsType } from "antd";
import styled from "@emotion/styled";
import { useEffect, useState } from "react";
import { unwrap } from "@cinegather/api-client";
import {
  adminPermissionKeys,
  adminPermissionLabels,
  type AdminPermission,
  type AdminRole,
  type AdminUser,
} from "@cinegather/contracts";
import { api, report } from "../controller";
const PermissionOptions = styled.div`
  .ant-checkbox-group {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }
`;
function includeRead(values: AdminPermission[]) {
  const set = new Set(values);
  if (set.has("users.manage")) set.add("users.read");
  if (set.has("rooms.manage")) set.add("rooms.read");
  return adminPermissionKeys.filter((p) => set.has(p));
}
function PermissionPicker({
  value = [],
  onChange,
}: {
  value?: AdminPermission[];
  onChange?: (value: AdminPermission[]) => void;
}) {
  return (
    <PermissionOptions>
      <Checkbox.Group
        options={adminPermissionKeys.map((p) => ({
          value: p,
          label: adminPermissionLabels[p],
        }))}
        value={value}
        onChange={(values) =>
          onChange?.(includeRead(values as AdminPermission[]))
        }
      />
    </PermissionOptions>
  );
}
export function RoleManagement({
  revision,
  search,
  height,
  onChanged,
}: {
  revision: number;
  search: string;
  height: number;
  onChanged: () => void;
}) {
  const [roles, setRoles] = useState<AdminRole[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState<string>();
  const [editor, setEditor] = useState<{
      role?: AdminRole;
      deleting?: boolean;
    }>(),
    [open, setOpen] = useState(false);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(undefined);
    void api
      .GET("/api/v1/admin/roles")
      .then(unwrap)
      .then((result) => {
        if (active) setRoles(result.items);
      })
      .catch((e) => {
        if (active) {
          setError(e instanceof Error ? e.message : "无法加载角色");
          report(e);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [revision]);
  const columns: TableColumnsType<AdminRole> = [
    {
      title: "角色名称",
      key: "name",
      width: 180,
      render: (_, role) => (
        <Space>
          {role.name}
          {role.builtIn && <Tag>内置</Tag>}
        </Space>
      ),
    },
    {
      title: "权限",
      dataIndex: "permissions",
      width: 300,
      render: (permissions: AdminPermission[]) => (
        <Space size={[4, 4]} wrap>
          {permissions.map((p) => (
            <Tag key={p}>{adminPermissionLabels[p]}</Tag>
          ))}
        </Space>
      ),
    },
    { title: "分配账号", dataIndex: "memberCount", width: 95 },
    {
      title: "操作",
      key: "actions",
      width: 150,
      fixed: "right",
      render: (_, role) =>
        role.builtIn ? (
          <span className="admin-muted">内置角色</span>
        ) : (
          <Space size={0}>
            <Button
              size="small"
              type="link"
              onClick={() => {
                setEditor({ role });
                setOpen(true);
              }}
            >
              编辑
            </Button>
            <Tooltip
              title={
                role.memberCount ? "先取消账号的此角色后才能删除" : undefined
              }
            >
              <Button
                size="small"
                type="link"
                danger
                disabled={role.memberCount > 0}
                onClick={() => {
                  setEditor({ role, deleting: true });
                  setOpen(true);
                }}
              >
                删除
              </Button>
            </Tooltip>
          </Space>
        ),
    },
  ];
  return (
    <>
      <Space style={{ marginBottom: 12 }}>
        <Button
          type="primary"
          onClick={() => {
            setEditor({});
            setOpen(true);
          }}
        >
          创建角色
        </Button>
      </Space>
      {error && <Alert type="error" showIcon title={error} />}
      <Table<AdminRole>
        rowKey="id"
        columns={columns}
        dataSource={
          error ? [] : roles.filter((role) => role.name.includes(search))
        }
        loading={loading}
        size="small"
        pagination={{
          defaultPageSize: 20,
          pageSizeOptions: [10, 20, 50],
          showSizeChanger: true,
        }}
        scroll={{ x: 740, y: Math.max(80, height - 52) }}
      />
      <RoleEditor
        open={open}
        role={editor?.role}
        deleting={editor?.deleting}
        onClose={() => setOpen(false)}
        afterClose={() => setEditor(undefined)}
        onChanged={onChanged}
      />
    </>
  );
}
function RoleEditor({
  open,
  role,
  deleting,
  onClose,
  afterClose,
  onChanged,
}: {
  open: boolean;
  role?: AdminRole;
  deleting?: boolean;
  onClose: () => void;
  afterClose: () => void;
  onChanged: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const { message } = App.useApp();
  async function save(values: {
    name: string;
    permissions: AdminPermission[];
    reason: string;
  }) {
    setSaving(true);
    try {
      if (deleting && role)
        unwrap(
          await api.POST("/api/v1/admin/roles/{roleId}/delete", {
            params: { path: { roleId: role.id } },
            body: { reason: values.reason },
          }),
        );
      else if (role)
        unwrap(
          await api.POST("/api/v1/admin/roles/{roleId}", {
            params: { path: { roleId: role.id } },
            body: values,
          }),
        );
      else unwrap(await api.POST("/api/v1/admin/roles", { body: values }));
      void message.success(
        deleting ? "角色已删除" : role ? "角色已更新" : "角色已创建",
      );
      onClose();
      onChanged();
    } catch (e) {
      report(e);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal
      open={open}
      title={deleting ? "删除角色" : role ? "编辑角色" : "创建角色"}
      width={560}
      okText={deleting ? "确认删除" : "保存角色"}
      cancelText="取消"
      confirmLoading={saving}
      okButtonProps={{
        danger: deleting,
        htmlType: "submit",
        form: "admin-role-editor",
      }}
      cancelButtonProps={{ disabled: saving }}
      closable={!saving}
      mask={{ closable: !saving }}
      onCancel={onClose}
      afterClose={afterClose}
      destroyOnHidden
    >
      {deleting && <p>删除角色“{role?.name}”？</p>}
      <Form
        id="admin-role-editor"
        layout="vertical"
        initialValues={{
          name: role?.name ?? "",
          permissions: role?.permissions ?? [],
          reason: "",
        }}
        onFinish={(values) => void save(values)}
        preserve={false}
      >
        {!deleting && (
          <>
            <Form.Item
              name="name"
              label="角色名称"
              rules={[
                { required: true, whitespace: true, message: "请输入角色名称" },
              ]}
            >
              <Input autoFocus maxLength={32} />
            </Form.Item>
            <Form.Item
              name="permissions"
              label="角色权限"
              rules={[
                {
                  type: "array",
                  required: true,
                  min: 1,
                  message: "至少选择一项权限",
                },
              ]}
            >
              <PermissionPicker />
            </Form.Item>
          </>
        )}
        <Form.Item
          name="reason"
          label="操作原因"
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
            rows={3}
            maxLength={200}
            showCount
            disabled={saving}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
export function UserRolesDialog({
  user,
  open,
  onClose,
  afterClose,
  onChanged,
}: {
  user?: AdminUser;
  open: boolean;
  onClose: () => void;
  afterClose: () => void;
  onChanged: () => void;
}) {
  const [roles, setRoles] = useState<AdminRole[]>([]),
    [loading, setLoading] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState<string>();
  const { message } = App.useApp();
  useEffect(() => {
    if (!open || !user) return;
    let active = true;
    setLoading(true);
    setError(undefined);
    void api
      .GET("/api/v1/admin/roles")
      .then(unwrap)
      .then((data) => {
        if (active) setRoles(data.items);
      })
      .catch((e) => {
        if (active) {
          setError(e instanceof Error ? e.message : "无法加载角色");
          report(e);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, user]);
  async function save(values: { roleIds: string[]; reason: string }) {
    if (!user) return;
    setSaving(true);
    try {
      unwrap(
        await api.POST("/api/v1/admin/users/{userId}/roles", {
          params: { path: { userId: user.id } },
          body: values,
        }),
      );
      void message.success("管理角色已更新");
      onClose();
      onChanged();
    } catch (e) {
      report(e);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal
      open={open}
      title="分配管理角色"
      okText="保存授权"
      cancelText="取消"
      confirmLoading={saving}
      okButtonProps={{
        disabled: loading || !!error,
        htmlType: "submit",
        form: "admin-user-roles",
      }}
      cancelButtonProps={{ disabled: saving }}
      closable={!saving}
      mask={{ closable: !saving }}
      onCancel={onClose}
      afterClose={afterClose}
      destroyOnHidden
    >
      <p>账号：{user?.username}</p>
      {error && <Alert type="error" showIcon title={error} />}
      <Form
        id="admin-user-roles"
        layout="vertical"
        initialValues={{
          roleIds: user?.roles.map((r) => r.id) ?? [],
          reason: "",
        }}
        onFinish={(values) => void save(values)}
        preserve={false}
      >
        <Form.Item name="roleIds" label="管理角色">
          <Select
            mode="multiple"
            aria-label="管理角色"
            allowClear
            loading={loading}
            disabled={loading || saving}
            placeholder="不分配角色时为普通用户"
            maxCount={20}
            options={roles.map((r) => ({ value: r.id, label: r.name }))}
          />
        </Form.Item>
        <Form.Item
          name="reason"
          label="操作原因"
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
            rows={3}
            maxLength={200}
            showCount
            disabled={saving}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
