import { useEffect, useState } from "react";
import {
  Alert,
  App,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from "antd";
import type { TableColumnsType } from "antd";
import {
  hasAdminPermission,
  type ManagedPartyWord,
  type PartyWordInput,
  type PartyImportPreview,
} from "@cinegather/contracts";
import { unwrap } from "@cinegather/api-client";
import { api, report } from "../controller";
import { useApp } from "../store";
import { Button } from "./Controls";
import {
  useRetainedDialog,
  type RetainedDialogProps,
} from "./useRetainedDialog";
const empty: PartyWordInput = {
  answer: "",
  category: "",
  clues: ["", "", ""],
  enabled: true,
};
const input = (word: PartyWordInput): PartyWordInput => ({
  answer: word.answer,
  category: word.category,
  clues: word.clues,
  enabled: word.enabled,
});
export function AdminPartyWords({
  revision,
  height,
}: {
  revision: number;
  height: number;
}) {
  const manage = hasAdminPermission(
      useApp((s) => s.user),
      "party-words.manage",
    ),
    { message } = App.useApp();
  const [items, setItems] = useState<ManagedPartyWord[]>([]),
    [total, setTotal] = useState(0),
    [all, setAll] = useState(0),
    [enabled, setEnabled] = useState(0);
  const [page, setPage] = useState(1),
    [q, setQ] = useState(""),
    [status, setStatus] = useState<"all" | "enabled" | "disabled">("all"),
    [refresh, setRefresh] = useState(0),
    [loading, setLoading] = useState(false),
    [pending, setPending] = useState<string>();
  const [editor, setEditor] = useState<{ word?: ManagedPartyWord }>(),
    [importing, setImporting] = useState<{ kind: "import" }>(),
    [deleting, setDeleting] = useState<ManagedPartyWord>();
  const editDialog = useRetainedDialog(editor),
    importDialog = useRetainedDialog(importing),
    deleteDialog = useRetainedDialog(deleting);
  const changed = () => setRefresh((r) => r + 1);
  useEffect(() => {
    let active = true;
    setLoading(true);
    void api
      .GET("/api/v1/admin/party-words", {
        params: { query: { q, status, page, pageSize: 20 } },
      })
      .then(unwrap)
      .then((r) => {
        if (active) {
          setItems(r.items);
          setTotal(r.total);
          setAll(r.allCount);
          setEnabled(r.enabledCount);
          if (page > 1 && !r.items.length && r.total < (page - 1) * 20 + 1)
            setPage(Math.max(1, Math.ceil(r.total / 20)));
        }
      })
      .catch(report)
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [q, status, page, refresh, revision]);
  async function toggle(word: ManagedPartyWord) {
    setPending(word.id);
    try {
      unwrap(
        await api.PATCH("/api/v1/admin/party-words/{id}", {
          params: { path: { id: word.id } },
          body: {
            ...input(word),
            enabled: !word.enabled,
            version: word.version,
          },
        }),
      );
      changed();
    } catch (e) {
      report(e);
    } finally {
      setPending(undefined);
    }
  }
  const columns: TableColumnsType<ManagedPartyWord> = [
    { title: "答案", dataIndex: "answer", width: 140 },
    { title: "分类", dataIndex: "category", width: 100 },
    {
      title: "递进提示",
      render: (_, r) => (
        <div>
          {r.clues.map((clue, i) => (
            <div key={i}>
              <Typography.Text type="secondary">{i + 1}. </Typography.Text>
              {clue}
            </div>
          ))}
        </div>
      ),
    },
    {
      title: "状态",
      width: 90,
      render: (_, r) =>
        manage ? (
          <Switch
            aria-label={`${r.answer}启用状态`}
            checked={r.enabled}
            loading={pending === r.id}
            disabled={!!pending}
            onChange={() => void toggle(r)}
          />
        ) : (
          <Tag>{r.enabled ? "已启用" : "已停用"}</Tag>
        ),
    },
    ...(manage
      ? [
          {
            title: "操作",
            width: 145,
            render: (_: unknown, r: ManagedPartyWord) => (
              <Space>
                <Button size="small" onClick={() => setEditor({ word: r })}>
                  编辑
                </Button>
                <Button size="small" danger onClick={() => setDeleting(r)}>
                  删除
                </Button>
              </Space>
            ),
          },
        ]
      : []),
  ];
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        height: "100%",
        minHeight: 0,
      }}
    >
      <Space wrap>
        <Input.Search
          aria-label="搜索题库"
          placeholder="搜索答案或分类"
          allowClear
          onSearch={(v) => {
            setQ(v.trim());
            setPage(1);
          }}
          style={{ width: 240 }}
        />
        <Select
          aria-label="筛选题目状态"
          value={status}
          options={[
            { value: "all", label: "全部状态" },
            { value: "enabled", label: "已启用" },
            { value: "disabled", label: "已停用" },
          ]}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
          style={{ width: 120 }}
        />
        <Typography.Text type="secondary">
          共 {all} 道，已启用 {enabled} 道
        </Typography.Text>
        {manage && (
          <>
            <Button type="primary" onClick={() => setEditor({})}>
              新增题目
            </Button>
            <Button onClick={() => setImporting({ kind: "import" })}>
              批量导入
            </Button>
          </>
        )}
      </Space>
      {enabled < 3 && (
        <Alert
          type="warning"
          title="启用题目不足 3 道，暂时无法开始新的聚会游戏"
        />
      )}
      <Table
        rowKey="id"
        size="small"
        columns={columns}
        dataSource={items}
        loading={loading}
        scroll={{ x: 760, y: Math.max(100, height - 70) }}
        pagination={{
          current: page,
          pageSize: 20,
          total,
          showSizeChanger: false,
          onChange: setPage,
        }}
      />
      {editDialog.value && (
        <WordEditor
          {...editDialog}
          target={editDialog.value}
          close={() => setEditor(undefined)}
          changed={changed}
        />
      )}
      {importDialog.value && (
        <WordImporter
          {...importDialog}
          close={() => setImporting(undefined)}
          changed={changed}
        />
      )}
      <Modal
        open={deleteDialog.open}
        afterClose={deleteDialog.afterClose}
        title="删除题目？"
        onCancel={() => {
          if (!pending) setDeleting(undefined);
        }}
        okText="删除"
        cancelText="取消"
        okButtonProps={{ danger: true }}
        confirmLoading={!!pending}
        onOk={async () => {
          if (!deleting || pending) return;
          const word = deleting;
          setPending(word.id);
          try {
            unwrap(
              await api.POST("/api/v1/admin/party-words/{id}/delete", {
                params: { path: { id: word.id } },
                body: { version: word.version },
              }),
            );
            setDeleting(undefined);
            changed();
            void message.success("题目已删除");
          } catch (e) {
            report(e);
          } finally {
            setPending(undefined);
          }
        }}
        destroyOnHidden
      >
        <p>
          删除「{deleteDialog.value?.answer}
          」后，新游戏将不再使用这道题。正在进行的游戏不受影响。
        </p>
      </Modal>
    </div>
  );
}
function WordEditor({
  target,
  open,
  afterClose,
  close,
  changed,
}: RetainedDialogProps & {
  target: { word?: ManagedPartyWord };
  close(): void;
  changed(): void;
}) {
  const [form] = Form.useForm<PartyWordInput>(),
    [saving, setSaving] = useState(false),
    { message } = App.useApp();
  async function save() {
    let values: PartyWordInput;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setSaving(true);
    try {
      unwrap(
        target.word
          ? await api.PATCH("/api/v1/admin/party-words/{id}", {
              params: { path: { id: target.word.id } },
              body: { ...values, version: target.word.version },
            })
          : await api.POST("/api/v1/admin/party-words", { body: values }),
      );
      changed();
      close();
      void message.success("题目已保存");
    } catch (e) {
      report(e);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal
      title={target.word ? "编辑题目" : "新增题目"}
      open={open}
      afterClose={afterClose}
      onCancel={() => {
        if (!saving) close();
      }}
      onOk={() => void save()}
      confirmLoading={saving}
      okText="保存"
      cancelText="取消"
      destroyOnHidden
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={target.word ? input(target.word) : empty}
        disabled={saving}
      >
        <Form.Item
          label="答案"
          name="answer"
          rules={[{ required: true, whitespace: true, max: 40 }]}
        >
          <Input maxLength={40} />
        </Form.Item>
        <Form.Item
          label="分类"
          name="category"
          rules={[{ required: true, whitespace: true, max: 24 }]}
        >
          <Input maxLength={24} />
        </Form.Item>
        {[0, 1, 2].map((i) => (
          <Form.Item
            key={i}
            label={`提示 ${i + 1}`}
            name={["clues", i]}
            rules={[{ required: true, whitespace: true, max: 160 }]}
          >
            <Input.TextArea rows={2} maxLength={160} />
          </Form.Item>
        ))}
        <Form.Item label="启用题目" name="enabled" valuePropName="checked">
          <Switch />
        </Form.Item>
      </Form>
    </Modal>
  );
}
const csvTemplate =
  "answer,category,clue1,clue2,clue3,enabled\n热气球,交通,它能带人离开地面,风会影响它前进方向,加热空气让它上升,true\n";
function template() {
  const url = URL.createObjectURL(
    new Blob(["\uFEFF" + csvTemplate], { type: "text/csv;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "映聚题库导入模板.csv";
  a.click();
  URL.revokeObjectURL(url);
}
function WordImporter({
  open,
  afterClose,
  close,
  changed,
}: RetainedDialogProps & { close(): void; changed(): void }) {
  const [format, setFormat] = useState<"csv" | "json">("csv"),
    [content, setContent] = useState(""),
    [preview, setPreview] = useState<PartyImportPreview>(),
    [busy, setBusy] = useState(false),
    { message } = App.useApp();
  async function check() {
    setBusy(true);
    try {
      setPreview(
        unwrap(
          await api.POST("/api/v1/admin/party-words/import/preview", {
            body: { format, content },
          }),
        ),
      );
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  }
  async function commit() {
    if (!preview || preview.errors.length || !preview.createCount) return;
    setBusy(true);
    try {
      const r = unwrap(
        await api.POST("/api/v1/admin/party-words/import/commit", {
          body: { format, content },
        }),
      );
      changed();
      close();
      void message.success(`已导入 ${r.created} 道，跳过已有 ${r.skipped} 道`);
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="批量导入题目"
      width={720}
      open={open}
      afterClose={afterClose}
      onCancel={() => {
        if (!busy) close();
      }}
      destroyOnHidden
      footer={
        <Space>
          <Button disabled={busy} onClick={close}>
            取消
          </Button>
          <Button disabled={!content || busy} onClick={() => void check()}>
            校验预览
          </Button>
          <Button
            type="primary"
            loading={busy}
            disabled={
              !preview || !!preview.errors.length || !preview.createCount
            }
            onClick={() => void commit()}
          >
            确认导入
          </Button>
        </Space>
      }
    >
      <Space wrap style={{ marginBottom: 12 }}>
        <Select
          aria-label="导入格式"
          value={format}
          disabled={busy}
          options={[
            { value: "csv", label: "CSV" },
            { value: "json", label: "JSON" },
          ]}
          onChange={(v) => {
            setFormat(v);
            setPreview(undefined);
          }}
        />
        <Button onClick={template}>下载 CSV 模板</Button>
        <input
          aria-label="选择题库文件"
          type="file"
          accept=".csv,.json"
          disabled={busy}
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            if (f.size > 200000) {
              void message.error("文件不能超过 200 KB");
              return;
            }
            setBusy(true);
            setPreview(undefined);
            try {
              setContent(await f.text());
              setFormat(
                f.name.toLowerCase().endsWith(".json") ? "json" : "csv",
              );
            } catch (err) {
              report(err);
            } finally {
              setBusy(false);
            }
          }}
        />
      </Space>
      <Typography.Paragraph type="secondary">
        每批最多 500
        道；相同答案已存在时跳过，不覆盖原题。出现错误时整批不导入。CSV 请使用
        UTF-8 编码，启用状态填写 true 或 false。
      </Typography.Paragraph>
      {format === "json" && (
        <Typography.Paragraph code>
          {JSON.stringify([
            {
              answer: "热气球",
              category: "交通",
              clues: ["提示一", "提示二", "提示三"],
              enabled: true,
            },
          ])}
        </Typography.Paragraph>
      )}
      <Input.TextArea
        aria-label="题库导入内容"
        rows={8}
        value={content}
        disabled={busy}
        maxLength={200000}
        placeholder={format === "csv" ? csvTemplate : "粘贴 JSON 数组"}
        onChange={(e) => {
          setContent(e.target.value);
          setPreview(undefined);
        }}
      />
      {preview && (
        <div style={{ marginTop: 12 }}>
          <Alert
            type={preview.errors.length ? "error" : "success"}
            title={`待新增 ${preview.createCount} 道，跳过 ${preview.skipCount} 道，错误 ${preview.errors.length} 条`}
            description={
              preview.errors.length ? (
                <div style={{ maxHeight: 150, overflow: "auto" }}>
                  {preview.errors.map((error, i) => (
                    <div key={i}>{error}</div>
                  ))}
                </div>
              ) : undefined
            }
          />
          {!preview.errors.length && preview.sample.length > 0 && (
            <Table
              size="small"
              rowKey="answer"
              pagination={false}
              scroll={{ y: 180 }}
              dataSource={preview.sample}
              columns={[
                { title: "预览答案（最多 10 道）", dataIndex: "answer" },
                { title: "分类", dataIndex: "category" },
                {
                  title: "状态",
                  render: (_, r) => (r.enabled ? "启用" : "停用"),
                },
              ]}
            />
          )}
        </div>
      )}
    </Modal>
  );
}
