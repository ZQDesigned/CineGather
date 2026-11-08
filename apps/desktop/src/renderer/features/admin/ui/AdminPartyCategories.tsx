import { useState } from "react";
import {
  App,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Switch,
  Tree,
  Tag,
  Typography,
} from "antd";
import { unwrap } from "@cinegather/api-client";
import {
  partyCategoryBranches,
  partyCategoryStats,
  type ManagedPartyWord,
  type PartyCategory,
  type PartyCatalog,
  type PartyPolicy,
} from "@cinegather/contracts";
import { api, report } from "../../../controller";
import { Button } from "../../rooms/ui/Controls";
import {
  useRetainedDialog,
  type RetainedDialogProps,
} from "../../../ui/useRetainedDialog";
import {
  partyCategoryTree,
  type PartyCategoryTreeNode,
} from "./party-category-tree";
import { PartyCategoryField } from "./PartyCategoryField";
export function AdminPartyCategories({
  catalog,
  changed,
  selected,
  manage,
}: {
  catalog: PartyCatalog;
  changed(): void;
  selected: ManagedPartyWord[];
  manage: boolean;
}) {
  const [open, setOpen] = useState(false),
    [editor, setEditor] = useState<{ category?: PartyCategory }>(),
    [deleting, setDeleting] = useState<PartyCategory>(),
    [policy, setPolicy] = useState<PartyPolicy>(),
    [moving, setMoving] = useState<ManagedPartyWord[]>();
  const edit = useRetainedDialog(editor),
    del = useRetainedDialog(deleting),
    rules = useRetainedDialog(policy),
    move = useRetainedDialog(moving);
  const [busy, setBusy] = useState(false);
  const { message } = App.useApp();
  return (
    <>
      <Button onClick={() => setOpen(true)}>分类管理</Button>
      {manage && (
        <>
          <Button onClick={() => setPolicy(structuredClone(catalog.policy))}>
            开局规则
          </Button>
          <Button
            disabled={!selected.length}
            onClick={() => setMoving([...selected])}
          >
            批量归类{selected.length ? `（${selected.length}）` : ""}
          </Button>
        </>
      )}
      <Modal
        title="题库分类"
        open={open}
        onCancel={() => setOpen(false)}
        footer={<Button onClick={() => setOpen(false)}>关闭</Button>}
        width={760}
      >
        {manage && (
          <Button type="primary" onClick={() => setEditor({})}>
            新增分类
          </Button>
        )}
        <div style={{ maxHeight: 360, overflowY: "auto", marginTop: 12 }}>
          <Tree<PartyCategoryTreeNode>
            aria-label="题库分类目录"
            blockNode
            showLine={{ showLeafIcon: false }}
            selectable={false}
            defaultExpandAll
            virtual={false}
            styles={{ itemTitle: { width: "100%", minWidth: 0 } }}
            treeData={partyCategoryTree(catalog.categories)}
            titleRender={(node) => {
              const c = node.category,
                ids = partyCategoryBranches(catalog.categories, c.id);
              const draw = partyCategoryStats(
                catalog.categories,
                ids,
                "draw",
              ).questionCount;
              const quiz = partyCategoryStats(
                catalog.categories,
                ids,
                "quiz",
              ).questionCount;
              return (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    width: "100%",
                    minWidth: 0,
                    padding: "6px 0",
                  }}
                >
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      fontWeight: c.parentId ? 400 : 600,
                    }}
                  >
                    {c.name}
                  </span>
                  {!c.enabled && <Tag>已停用</Tag>}
                  <Typography.Text
                    type="secondary"
                    style={{ whiteSpace: "nowrap", fontSize: 12 }}
                  >
                    绘画 {draw} / 猜词 {quiz}
                  </Typography.Text>
                  {manage && (
                    <Space
                      onClick={(e) => e.stopPropagation()}
                      onDoubleClick={(e) => e.stopPropagation()}
                    >
                      <Button
                        size="small"
                        onClick={() => setEditor({ category: c })}
                      >
                        编辑
                      </Button>
                      <Button
                        size="small"
                        danger
                        onClick={() => setDeleting(c)}
                      >
                        删除
                      </Button>
                    </Space>
                  )}
                </div>
              );
            }}
          />
        </div>
      </Modal>
      {edit.value && (
        <CategoryEditor
          {...edit}
          target={edit.value}
          categories={catalog.categories}
          close={() => setEditor(undefined)}
          changed={changed}
        />
      )}
      {rules.value && (
        <PolicyEditor
          {...rules}
          policy={rules.value}
          close={() => setPolicy(undefined)}
          changed={changed}
        />
      )}
      {move.value && (
        <MoveEditor
          {...move}
          words={move.value}
          categories={catalog.categories}
          close={() => setMoving(undefined)}
          changed={changed}
        />
      )}
      <Modal
        title="删除分类？"
        open={del.open}
        afterClose={del.afterClose}
        onCancel={() => {
          if (!busy) setDeleting(undefined);
        }}
        okText="删除"
        cancelText="取消"
        confirmLoading={busy}
        okButtonProps={{ danger: true }}
        onOk={async () => {
          if (!del.value || busy) return;
          const c = del.value;
          setBusy(true);
          try {
            unwrap(
              await api.POST("/api/v1/admin/party-categories/{id}/delete", {
                params: { path: { id: c.id } },
                body: { version: c.version },
              }),
            );
            setDeleting(undefined);
            changed();
            void message.success("分类已删除");
          } catch (e) {
            report(e);
          } finally {
            setBusy(false);
          }
        }}
      >
        <p>删除「{del.value?.name}」？含有题目或子分类时，请先移动内容。</p>
      </Modal>
    </>
  );
}
function CategoryEditor({
  target,
  categories,
  open,
  afterClose,
  close,
  changed,
}: RetainedDialogProps & {
  target: { category?: PartyCategory };
  categories: PartyCategory[];
  close(): void;
  changed(): void;
}) {
  const [form] = Form.useForm();
  const [busy, setBusy] = useState(false);
  const c = target.category;
  return (
    <Modal
      title={c ? "编辑分类" : "新增分类"}
      open={open}
      afterClose={afterClose}
      onCancel={() => {
        if (!busy) close();
      }}
      confirmLoading={busy}
      okText="保存"
      cancelText="取消"
      destroyOnHidden
      onOk={async () => {
        if (busy) return;
        try {
          const data = await form.validateFields();
          setBusy(true);
          unwrap(
            c
              ? await api.PATCH("/api/v1/admin/party-categories/{id}", {
                  params: { path: { id: c.id } },
                  body: {
                    ...data,
                    parentId: data.parentId ?? null,
                    version: c.version,
                  },
                })
              : await api.POST("/api/v1/admin/party-categories", {
                  body: { ...data, parentId: data.parentId ?? null },
                }),
          );
          close();
          changed();
        } catch (e) {
          if (!(e as { errorFields?: unknown }).errorFields) report(e);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Form
        form={form}
        layout="vertical"
        disabled={busy}
        initialValues={
          c ?? { name: "", parentId: null, enabled: true, sortOrder: 0 }
        }
      >
        <Form.Item
          label="分类名称"
          name="name"
          rules={[{ required: true, whitespace: true, max: 40 }]}
        >
          <Input maxLength={40} />
        </Form.Item>
        <Form.Item label="上级分类" name="parentId">
          <Select
            aria-label="上级分类"
            allowClear
            placeholder="不选择则为一级分类"
            options={categories
              .filter((root) => !root.parentId && root.id !== c?.id)
              .map((root) => ({ value: root.id, label: root.name }))}
          />
        </Form.Item>
        <Form.Item label="排序" name="sortOrder" rules={[{ required: true }]}>
          <InputNumber min={0} max={10000} />
        </Form.Item>
        <Form.Item label="启用" name="enabled" valuePropName="checked">
          <Switch />
        </Form.Item>
      </Form>
    </Modal>
  );
}
function PolicyEditor({
  policy,
  open,
  afterClose,
  close,
  changed,
}: RetainedDialogProps & {
  policy: PartyPolicy;
  close(): void;
  changed(): void;
}) {
  const [form] = Form.useForm();
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title="聚会游戏开局规则"
      open={open}
      afterClose={afterClose}
      onCancel={() => {
        if (!busy) close();
      }}
      okText="保存"
      cancelText="取消"
      confirmLoading={busy}
      destroyOnHidden
      onOk={async () => {
        if (busy) return;
        try {
          const v = await form.validateFields();
          setBusy(true);
          unwrap(
            await api.POST("/api/v1/admin/party-categories/policy", {
              body: { ...v, version: policy.version },
            }),
          );
          close();
          changed();
        } catch (e) {
          if (!(e as { errorFields?: unknown }).errorFields) report(e);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Form
        layout="vertical"
        form={form}
        initialValues={policy}
        disabled={busy}
      >
        {(["draw", "quiz"] as const).map((mode) => (
          <div key={mode}>
            <Typography.Title level={5}>
              {mode === "draw" ? "你画我猜" : "猜词抢答"}
            </Typography.Title>
            <Form.Item
              label="最低可用题数"
              name={[mode, "minQuestions"]}
              rules={[{ required: true }]}
            >
              <InputNumber min={mode === "draw" ? 6 : 3} max={10000} />
            </Form.Item>
            <Form.Item
              label="最低分类数（0 表示不限制）"
              name={[mode, "minCategories"]}
              rules={[{ required: true }]}
            >
              <InputNumber min={0} max={500} />
            </Form.Item>
          </div>
        ))}
      </Form>
    </Modal>
  );
}
function MoveEditor({
  words,
  categories,
  open,
  afterClose,
  close,
  changed,
}: RetainedDialogProps & {
  words: ManagedPartyWord[];
  categories: PartyCategory[];
  close(): void;
  changed(): void;
}) {
  const [categoryId, setCategoryId] = useState<string>(),
    [busy, setBusy] = useState(false);
  return (
    <Modal
      title="批量修改题目分类"
      open={open}
      afterClose={afterClose}
      onCancel={() => {
        if (!busy) close();
      }}
      okText="保存"
      cancelText="取消"
      confirmLoading={busy}
      okButtonProps={{ disabled: !categoryId }}
      onOk={async () => {
        if (!categoryId || busy) return;
        setBusy(true);
        try {
          unwrap(
            await api.POST("/api/v1/admin/party-categories/move-words", {
              body: {
                categoryId,
                items: words.map((w) => ({ id: w.id, version: w.version })),
              },
            }),
          );
          close();
          changed();
        } catch (e) {
          report(e);
        } finally {
          setBusy(false);
        }
      }}
    >
      <p>已选择 {words.length} 道题</p>
      <PartyCategoryField
        categories={categories}
        value={categoryId}
        onChange={setCategoryId}
      />
    </Modal>
  );
}
