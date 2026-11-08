import { useEffect, useRef, useState } from "react";
import {
  Alert,
  App,
  Button,
  Collapse,
  Drawer,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Typography,
} from "antd";
import {
  hasAdminPermission,
  partySubmissionDraft,
  type PartyCatalog,
  type PartySubmission,
  type PartySubmissionDraft,
} from "@cinegather/contracts";
import { unwrap } from "@cinegather/api-client";
import { api } from "../../../controller";
import { useApp } from "../../../store";
import { useRetainedDialog } from "../../../ui/useRetainedDialog";
import {
  QuestionFields,
  QuestionReadout,
  SubmissionStatus,
  submissionStatuses,
} from "./QuestionFields";
const errorText = (e: unknown) =>
  e instanceof Error ? e.message : "无法读取投稿，请稍后重试";
export function SubmissionReview({
  revision,
  height,
}: {
  revision: number;
  height: number;
}) {
  const canReview = hasAdminPermission(
    useApp((s) => s.user),
    "party-submissions.review",
  );
  const [items, setItems] = useState<PartySubmission[]>([]),
    [total, setTotal] = useState(0),
    [pending, setPending] = useState(0),
    [catalog, setCatalog] = useState<PartyCatalog>(),
    [status, setStatus] = useState<"all" | PartySubmission["status"]>(
      "pending",
    ),
    [q, setQ] = useState(""),
    [page, setPage] = useState(1),
    [refresh, setRefresh] = useState(0),
    [loading, setLoading] = useState(false),
    [error, setError] = useState<string>(),
    [target, setTarget] = useState<PartySubmission>();
  const dialog = useRetainedDialog(target),
    { message } = App.useApp();
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(undefined);
    void Promise.all([
      api
        .GET("/api/v1/admin/party-submissions", {
          params: { query: { status, q, page, pageSize: 20 } },
        })
        .then(unwrap),
      api.GET("/api/v1/party-submissions/catalog").then(unwrap),
    ])
      .then(([r, c]) => {
        if (active) {
          setItems(r.items);
          setTotal(r.total);
          setPending(r.pendingCount);
          setCatalog(c);
          if (page > 1 && !r.items.length)
            setPage(Math.max(1, Math.ceil(r.total / 20)));
        }
      })
      .catch((e) => {
        if (active) setError(errorText(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [status, q, page, revision, refresh]);
  return (
    <>
      <Space wrap style={{ marginBottom: 16 }}>
        <Input.Search
          aria-label="搜索投稿"
          placeholder="搜索答案、投稿人"
          allowClear
          onSearch={(v) => {
            setQ(v);
            setPage(1);
          }}
          style={{ width: 260 }}
        />
        <Select
          aria-label="审核状态"
          value={status}
          style={{ width: 140 }}
          options={[{ value: "all", label: "全部状态" }, ...submissionStatuses]}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
        />
        <Button onClick={() => setRefresh((n) => n + 1)}>刷新投稿</Button>
        <Typography.Text type="secondary">待审核 {pending} 道</Typography.Text>
      </Space>
      {error && (
        <Alert
          type="error"
          showIcon
          title={error}
          style={{ marginBottom: 12 }}
        />
      )}
      <Table<PartySubmission>
        rowKey="id"
        loading={loading}
        dataSource={items}
        scroll={{ x: 920, y: Math.max(180, height - 135) }}
        pagination={{
          current: page,
          total,
          pageSize: 20,
          showSizeChanger: false,
          onChange: setPage,
        }}
        columns={[
          {
            title: "答案",
            key: "answer",
            render: (_, r) => r.draft.answer,
            width: 170,
          },
          {
            title: "投稿人",
            key: "author",
            render: (_, r) => `${r.author.displayName}（${r.author.username}）`,
            width: 260,
          },
          { title: "分类", dataIndex: "categoryPath", width: 170 },
          {
            title: "状态",
            key: "status",
            render: (_, r) => <SubmissionStatus status={r.status} />,
            width: 100,
          },
          {
            title: "提交时间",
            dataIndex: "createdAt",
            render: (v) => new Date(v).toLocaleString(),
            width: 170,
          },
          {
            title: "操作",
            key: "action",
            fixed: "right",
            width: 90,
            render: (_, r) => (
              <Button type="link" onClick={() => setTarget(r)}>
                {canReview && r.status === "pending" ? "审核" : "查看"}
              </Button>
            ),
          },
        ]}
      />
      {dialog.value && catalog && (
        <ReviewDrawer
          submission={dialog.value}
          catalog={catalog}
          canReview={canReview}
          open={dialog.open}
          afterClose={dialog.afterClose}
          onClose={() => setTarget(undefined)}
          onSaved={() => {
            const displayed = dialog.value;
            setTarget((current) =>
              current === displayed ? undefined : current,
            );
            setRefresh((n) => n + 1);
            void message.success("审核结果已保存");
          }}
        />
      )}
    </>
  );
}
function ReviewDrawer({
  submission,
  catalog,
  canReview,
  open,
  afterClose,
  onClose,
  onSaved,
}: {
  submission: PartySubmission;
  catalog: PartyCatalog;
  canReview: boolean;
  open: boolean;
  afterClose(): void;
  onClose(): void;
  onSaved(): void;
}) {
  const [item, setItem] = useState(submission),
    [form] = Form.useForm<PartySubmissionDraft>(),
    [rejectForm] = Form.useForm<{ reason: string }>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string>(),
    [fetching, setFetching] = useState(true),
    [reject, setReject] = useState<{ id: string }>();
  const rejectDialog = useRetainedDialog(reject),
    mounted = useRef(true),
    context = useRef({ submission, open }),
    request = useRef(0),
    completeAfterReject = useRef(false);
  context.current = { submission, open };
  const current = () =>
    mounted.current &&
    context.current.submission === submission &&
    context.current.open;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function load() {
    const serial = ++request.current;
    const valid = () => current() && request.current === serial;
    setFetching(true);
    setError(undefined);
    try {
      const r = unwrap(
        await api.GET("/api/v1/admin/party-submissions/{id}", {
          params: { path: { id: submission.id } },
        }),
      );
      if (valid()) {
        setItem(r);
        form.setFieldsValue(structuredClone(r.draft));
      }
    } catch (e) {
      if (valid()) setError(errorText(e));
    } finally {
      if (valid()) setFetching(false);
    }
  }
  useEffect(() => {
    if (open) {
      setBusy(false);
      void load();
    }
    return () => {
      request.current++;
    };
  }, [submission, open]); // Snapshot remains mounted throughout exit.
  const values = Form.useWatch([], form),
    editable = canReview && item.status === "pending";
  const parsed = partySubmissionDraft.safeParse(values);
  const edited =
    parsed.success &&
    JSON.stringify(parsed.data) !== JSON.stringify(item.draft);
  async function approve() {
    const values = await form.validateFields().catch(() => undefined);
    if (!values) return;
    const parsed = partySubmissionDraft.safeParse(values);
    if (!parsed.success) {
      setError("请填写完整的题目及提示");
      return;
    }
    await decide({ decision: "approve", draft: parsed.data });
  }
  async function decide(
    decision:
      | { decision: "approve"; draft: PartySubmissionDraft }
      | { decision: "reject"; reason: string },
  ) {
    if (busy || fetching || !editable) return;
    setBusy(true);
    setError(undefined);
    try {
      unwrap(
        await api.POST("/api/v1/admin/party-submissions/{id}/review", {
          params: { path: { id: item.id } },
          body: { ...decision, version: item.version },
        }),
      );
      if (current() && rejectDialog.value) {
        completeAfterReject.current = true;
        setReject(undefined);
      } else onSaved();
    } catch (e) {
      if (current()) {
        setReject(undefined);
        setError(errorText(e));
      }
    } finally {
      if (current()) setBusy(false);
    }
  }
  return (
    <>
      <Drawer
        title={editable ? "审核投稿" : "投稿详情"}
        open={open}
        onClose={onClose}
        afterOpenChange={(shown) => {
          if (!shown) afterClose();
        }}
        size={640}
        footer={
          <Space style={{ width: "100%", justifyContent: "flex-end" }}>
            <Button onClick={onClose}>关闭</Button>
            {editable && (
              <>
                <Button
                  danger
                  disabled={busy || fetching}
                  onClick={() => {
                    rejectForm.resetFields();
                    setReject({ id: item.id });
                  }}
                >
                  驳回
                </Button>
                <Button
                  type="primary"
                  loading={busy}
                  disabled={fetching}
                  onClick={() => void approve()}
                >
                  {edited ? "修改并收录" : "直接收录"}
                </Button>
              </>
            )}
          </Space>
        }
      >
        <Space wrap style={{ marginBottom: 20 }}>
          <SubmissionStatus status={item.status} />
          <span>
            {item.author.displayName}（{item.author.username}）
          </span>
        </Space>
        {error && (
          <Alert
            type="error"
            title={error}
            action={
              <Button onClick={() => void load()} disabled={busy}>
                重新加载
              </Button>
            }
            style={{ marginBottom: 16 }}
          />
        )}
        {item.reason && (
          <Alert
            type="warning"
            title="驳回原因"
            description={item.reason}
            style={{ marginBottom: 16 }}
          />
        )}
        {editable ? (
          <Form form={form} layout="vertical" disabled={busy || fetching}>
            <QuestionFields categories={catalog.categories} />
          </Form>
        ) : (
          <QuestionReadout
            draft={item.reviewedDraft ?? item.draft}
            path={item.reviewedCategoryPath ?? item.categoryPath}
          />
        )}
        {(edited || item.reviewedDraft) && (
          <Collapse
            items={[
              {
                key: "original",
                label: "查看原始投稿",
                children: (
                  <QuestionReadout
                    draft={item.draft}
                    path={item.categoryPath}
                  />
                ),
              },
            ]}
          />
        )}
        {item.reviewerName && (
          <Typography.Paragraph type="secondary" style={{ marginTop: 20 }}>
            审核人：{item.reviewerName}
          </Typography.Paragraph>
        )}
      </Drawer>
      {rejectDialog.value && (
        <Modal
          title="驳回投稿"
          open={rejectDialog.open}
          afterClose={() => {
            rejectDialog.afterClose();
            if (completeAfterReject.current) {
              completeAfterReject.current = false;
              onSaved();
            }
          }}
          onCancel={() => setReject(undefined)}
          footer={
            <Space>
              <Button onClick={() => setReject(undefined)}>取消</Button>
              <Button
                danger
                type="primary"
                loading={busy}
                onClick={() =>
                  void rejectForm
                    .validateFields()
                    .then((v) =>
                      decide({ decision: "reject", reason: v.reason }),
                    )
                    .catch(() => undefined)
                }
              >
                确认驳回
              </Button>
            </Space>
          }
        >
          <Form form={rejectForm} layout="vertical">
            <Form.Item
              label="驳回原因"
              name="reason"
              rules={[
                { required: true, whitespace: true, message: "请输入驳回原因" },
                { min: 2, max: 200 },
              ]}
            >
              <Input.TextArea
                rows={4}
                maxLength={200}
                showCount
                disabled={busy}
              />
            </Form.Item>
          </Form>
        </Modal>
      )}
    </>
  );
}
