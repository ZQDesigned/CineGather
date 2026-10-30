import { useEffect, useState } from "react";
import {
  App,
  Checkbox,
  Form,
  Input,
  Modal,
  Radio,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
} from "antd";
import type { TableColumnsType } from "antd";
import { unwrap } from "@cinegather/api-client";
import {
  hasAdminPermission,
  type Announcement,
  type AnnouncementInput,
} from "@cinegather/contracts";
import { useApp } from "../store";
import { api, report } from "../controller";
import { Button } from "./Controls";
import { AnnouncementBody } from "./Announcements";
const labels = {
  draft: "草稿",
  scheduled: "待发送",
  active: "生效中",
  expired: "已结束",
  withdrawn: "已撤回",
};
const date = (v: string | null) =>
  v ? new Date(v).toLocaleString("zh-CN", { hour12: false }) : "—";
const local = (v: string | null) =>
  v
    ? new Date(Date.parse(v) - new Date(v).getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16)
    : "";
interface Fields {
  title: string;
  body: string;
  kind: "notice" | "maintenance";
  popup: boolean;
  timing: "now" | "scheduled";
  startsAt?: string;
  ending: "week" | "custom";
  expiresAt?: string;
}
function input(values: Fields): AnnouncementInput {
  return {
    title: values.title.trim(),
    body: values.body.trim(),
    kind: values.kind,
    popup: values.popup,
    startsAt:
      values.timing === "scheduled" && values.startsAt
        ? new Date(values.startsAt).toISOString()
        : null,
    expiresAt:
      values.ending === "custom" && values.expiresAt
        ? new Date(values.expiresAt).toISOString()
        : null,
  };
}
export function AdminAnnouncements({
  revision,
  height,
}: {
  revision: number;
  height: number;
}) {
  const user = useApp((s) => s.user),
    manage = hasAdminPermission(user, "announcements.manage"),
    { modal, message } = App.useApp();
  const [items, setItems] = useState<Announcement[]>([]),
    [total, setTotal] = useState(0),
    [page, setPage] = useState(1),
    [search, setSearch] = useState("");
  const [refresh, setRefresh] = useState(0),
    [loading, setLoading] = useState(false),
    [saving, setSaving] = useState(false);
  const [editor, setEditor] = useState(false),
    [editing, setEditing] = useState<Announcement>(),
    [preview, setPreview] = useState(false),
    [view, setView] = useState<Announcement>();
  const [form] = Form.useForm<Fields>(),
    values = Form.useWatch([], form);
  useEffect(() => {
    let active = true;
    setLoading(true);
    void api
      .GET("/api/v1/admin/announcements", {
        params: { query: { q: search, page, pageSize: 20 } },
      })
      .then(unwrap)
      .then((result) => {
        if (active) {
          setItems(result.items);
          setTotal(result.total);
        }
      })
      .catch(report)
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [revision, refresh, page, search, user?.permissions, user?.isSuperAdmin]);
  const edit = (a?: Announcement) => {
    setEditing(a);
    setPreview(false);
    form.resetFields();
    form.setFieldsValue(
      a
        ? {
            title: a.title,
            body: a.body,
            kind: a.kind,
            popup: a.popup,
            timing: a.startsAt ? "scheduled" : "now",
            startsAt: local(a.startsAt),
            ending: a.expiresAt ? "custom" : "week",
            expiresAt: local(a.expiresAt),
          }
        : {
            title: "",
            body: "",
            kind: "notice",
            popup: true,
            timing: "now",
            ending: "week",
          },
    );
    setEditor(true);
  };
  const save = async () => {
    const fields = await form.validateFields();
    setSaving(true);
    try {
      const body = input(fields);
      if (editing)
        unwrap(
          await api.PATCH("/api/v1/admin/announcements/{announcementId}", {
            params: { path: { announcementId: editing.id } },
            body,
          }),
        );
      else
        unwrap(
          await api.POST("/api/v1/admin/announcements", {
            body,
            headers: { "Idempotency-Key": crypto.randomUUID() },
          }),
        );
      setEditor(false);
      setRefresh((r) => r + 1);
      void message.success("公告草稿已保存");
    } catch (e) {
      report(e);
    } finally {
      setSaving(false);
    }
  };
  const publish = (a: Announcement) =>
    modal.confirm({
      title: a.startsAt ? "确认安排全站公告" : "确认发布全站公告",
      width: 680,
      content: (
        <div>
          <h3>{a.title}</h3>
          <AnnouncementBody item={a} />
          <Typography.Paragraph style={{ marginTop: 16, marginBottom: 0 }}>
            公告将向全站用户展示{a.popup ? "，并弹窗提醒" : ""}。
            {a.startsAt
              ? "将在 " + date(a.startsAt) + " 发送。"
              : "确认后立即发送。"}
            {!a.expiresAt ? "默认生效 7 天。" : ""}
          </Typography.Paragraph>
        </div>
      ),
      okText: a.startsAt ? "确认定时发送" : "确认发布",
      cancelText: "取消",
      onOk: async () => {
        try {
          unwrap(
            await api.POST(
              "/api/v1/admin/announcements/{announcementId}/publish",
              { params: { path: { announcementId: a.id } } },
            ),
          );
          setRefresh((r) => r + 1);
          void message.success(a.startsAt ? "公告已安排" : "公告已发布");
        } catch (e) {
          report(e);
          throw e;
        }
      },
    });
  const withdraw = (a: Announcement) =>
    modal.confirm({
      title: a.state === "scheduled" ? "取消定时公告" : "撤回公告",
      content:
        a.state === "scheduled"
          ? "取消后不会再发送这条公告。"
          : "撤回后将停止提醒并移除维护横幅。",
      okText: "确认撤回",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        try {
          unwrap(
            await api.POST(
              "/api/v1/admin/announcements/{announcementId}/withdraw",
              { params: { path: { announcementId: a.id } } },
            ),
          );
          setRefresh((r) => r + 1);
          void message.success("公告已撤回");
        } catch (e) {
          report(e);
          throw e;
        }
      },
    });
  const columns: TableColumnsType<Announcement> = [
    { title: "公告", dataIndex: "title", width: 210, ellipsis: true },
    {
      title: "状态",
      dataIndex: "state",
      width: 95,
      render: (v: Announcement["state"]) => (
        <Tag
          color={
            v === "active" ? "green" : v === "scheduled" ? "blue" : undefined
          }
        >
          {labels[v]}
        </Tag>
      ),
    },
    {
      title: "展示方式",
      width: 150,
      render: (_, a) =>
        `${a.kind === "maintenance" ? "维护横幅" : "通知"}${a.popup ? " / 弹窗" : ""}`,
    },
    {
      title: "发送时间",
      width: 175,
      render: (_, a) => date(a.publishedAt ?? a.startsAt),
    },
    { title: "结束时间", width: 175, render: (_, a) => date(a.expiresAt) },
    {
      title: "操作",
      width: 210,
      render: (_, a) => (
        <Space size={0}>
          <Button size="small" type="link" onClick={() => setView(a)}>
            预览
          </Button>
          {manage && (
            <>
              {a.state === "draft" && (
                <>
                  <Button size="small" type="link" onClick={() => edit(a)}>
                    编辑
                  </Button>
                  <Button size="small" type="link" onClick={() => publish(a)}>
                    发布
                  </Button>
                </>
              )}
              {a.state !== "withdrawn" && (
                <Button
                  size="small"
                  type="link"
                  danger
                  onClick={() => withdraw(a)}
                >
                  撤回
                </Button>
              )}
            </>
          )}
        </Space>
      ),
    },
  ];
  let previewItem: Announcement | undefined;
  try {
    if (values?.title && values.body)
      previewItem = {
        ...input(values),
        id: editing?.id ?? crypto.randomUUID(),
        state: "draft",
        publishedAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
  } catch {
    /* The editor validates incomplete dates before saving. */
  }
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        flex: 1,
        gap: 14,
      }}
      aria-label="公告管理"
    >
      <div
        style={{ display: "flex", justifyContent: "space-between", gap: 12 }}
      >
        <Input.Search
          style={{ maxWidth: 320 }}
          aria-label="搜索公告"
          placeholder="搜索公告标题"
          allowClear
          onSearch={(v) => {
            setSearch(v);
            setPage(1);
          }}
        />
        {manage && (
          <Button type="primary" onClick={() => edit()}>
            新建公告
          </Button>
        )}
      </div>
      <Table
        rowKey="id"
        size="small"
        columns={columns}
        dataSource={items}
        loading={loading}
        scroll={{ x: 1020, y: height }}
        pagination={{ current: page, pageSize: 20, total, onChange: setPage }}
      />
      <Modal
        title={editing ? "编辑公告草稿" : "新建公告"}
        open={editor}
        onCancel={() => setEditor(false)}
        width={760}
        destroyOnHidden
        footer={
          <>
            <Button onClick={() => setEditor(false)}>取消</Button>
            <Button type="primary" loading={saving} onClick={() => void save()}>
              保存草稿
            </Button>
          </>
        }
      >
        <Tabs
          activeKey={preview ? "preview" : "edit"}
          onChange={(key) => {
            if (key === "preview")
              void form
                .validateFields()
                .then(() => setPreview(true))
                .catch(() => {});
            else setPreview(false);
          }}
          items={[
            { key: "edit", label: "编辑" },
            { key: "preview", label: "预览" },
          ]}
        />
        <div style={{ maxHeight: "58vh", overflowY: "auto", paddingRight: 4 }}>
          <Form form={form} layout="vertical" hidden={preview} preserve>
            <Form.Item
              name="title"
              label="公告标题"
              rules={[{ required: true, whitespace: true, max: 120 }]}
            >
              <Input maxLength={120} />
            </Form.Item>
            <Form.Item
              name="body"
              label="公告内容"
              rules={[{ required: true, whitespace: true, max: 4000 }]}
            >
              <Input.TextArea rows={5} maxLength={4000} showCount />
            </Form.Item>
            <Form.Item name="kind" label="公告类型">
              <Radio.Group
                options={[
                  { value: "notice", label: "普通公告" },
                  { value: "maintenance", label: "维护公告（显示横幅）" },
                ]}
              />
            </Form.Item>
            <Form.Item name="popup" valuePropName="checked">
              <Checkbox>弹窗提醒</Checkbox>
            </Form.Item>
            <Form.Item name="timing" label="发送时间">
              <Radio.Group
                options={[
                  { value: "now", label: "立即发送" },
                  { value: "scheduled", label: "定时发送" },
                ]}
              />
            </Form.Item>
            {values?.timing === "scheduled" && (
              <Form.Item
                name="startsAt"
                label="定时发送时间"
                rules={[
                  { required: true, message: "请选择发送时间" },
                  {
                    validator: (_, v) =>
                      !v || new Date(v).getTime() > Date.now()
                        ? Promise.resolve()
                        : Promise.reject(new Error("请选择未来的发送时间")),
                  },
                ]}
              >
                <Input type="datetime-local" />
              </Form.Item>
            )}
            <Form.Item name="ending" label="结束时间">
              <Radio.Group
                options={[
                  { value: "week", label: "发送后 7 天" },
                  { value: "custom", label: "指定时间" },
                ]}
              />
            </Form.Item>
            {values?.ending === "custom" && (
              <Form.Item
                name="expiresAt"
                label="指定结束时间"
                rules={[
                  { required: true, message: "请选择结束时间" },
                  {
                    validator: (_, v) =>
                      !v ||
                      new Date(v).getTime() >
                        Math.max(
                          Date.now(),
                          values.startsAt && values.timing === "scheduled"
                            ? new Date(values.startsAt).getTime()
                            : 0,
                        )
                        ? Promise.resolve()
                        : Promise.reject(new Error("结束时间应晚于发送时间")),
                  },
                ]}
              >
                <Input type="datetime-local" />
              </Form.Item>
            )}
          </Form>
          {preview && previewItem && (
            <>
              <h3>{previewItem.title}</h3>
              <AnnouncementBody item={previewItem} />
            </>
          )}
        </div>
      </Modal>
      <Modal
        title={view?.title ?? "公告预览"}
        open={!!view}
        onCancel={() => setView(undefined)}
        width={760}
        footer={<Button onClick={() => setView(undefined)}>关闭</Button>}
      >
        {view && <AnnouncementBody item={view} />}
      </Modal>
    </div>
  );
}
