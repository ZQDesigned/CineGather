import { useEffect, useRef, useState } from "react";
import styled from "@emotion/styled";
import { Plus, RefreshCw } from "lucide-react";
import {
  Alert,
  App,
  Button,
  Card,
  Divider,
  Empty,
  Form,
  Modal,
  Progress,
  Select,
  Space,
  Table,
  Typography,
} from "antd";
import type {
  PartyCatalog,
  PartySubmission,
  PartySubmissionDraft,
  SubmissionEligibility,
} from "@cinegather/contracts";
import { partySubmissionDraft } from "@cinegather/contracts";
import { unwrap } from "@cinegather/api-client";
import { api } from "../../../controller";
import { useRetainedDialog } from "../../../ui/useRetainedDialog";
import { PageHeading, PageSurface } from "../../../ui/layout/Page";
import {
  QuestionFields,
  QuestionReadout,
  newQuestion,
  SubmissionStatus,
  submissionStatuses,
} from "./QuestionFields";
const errorText = (e: unknown) =>
  e instanceof Error ? e.message : "操作失败，请稍后重试";
const Surface = styled(PageSurface)`
  .submission-eligibility .ant-card-body {
    padding: 16px 18px;
  }
  .submission-eligibility-grid {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 20px 32px;
  }
  .submission-age {
    flex: 0 0 170px;
  }
  .submission-age-value {
    margin-top: 8px;
  }
  .submission-progress {
    flex: 1 1 240px;
    max-width: 420px;
    min-width: 0;
  }
  .submission-progress-heading,
  .submission-history-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
  }
  .submission-history-heading h2 {
    margin: 0;
    font-size: 16px;
    line-height: 24px;
    font-weight: 600;
  }
  .submission-status {
    width: 130px;
  }
`;
export function QuestionSubmissions() {
  const [eligibility, setEligibility] = useState<SubmissionEligibility>(),
    [catalog, setCatalog] = useState<PartyCatalog>(),
    [items, setItems] = useState<PartySubmission[]>([]),
    [total, setTotal] = useState(0),
    [page, setPage] = useState(1),
    [status, setStatus] = useState("all"),
    [revision, setRevision] = useState(0),
    [loading, setLoading] = useState(false),
    [error, setError] = useState<string>();
  const [editor, setEditor] = useState<{ item?: PartySubmission }>(),
    [detail, setDetail] = useState<PartySubmission>();
  const editDialog = useRetainedDialog(editor),
    detailDialog = useRetainedDialog(detail),
    { message } = App.useApp();
  const refresh = () => setRevision((n) => n + 1);
  useEffect(() => {
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(undefined);
    void Promise.all([
      api.GET("/api/v1/party-submissions/eligibility").then(unwrap),
      api.GET("/api/v1/party-submissions/catalog").then(unwrap),
      api
        .GET("/api/v1/party-submissions", {
          params: {
            query: {
              page,
              pageSize: 20,
              status: status as "all" | PartySubmission["status"],
            },
          },
        })
        .then(unwrap),
    ])
      .then(([e, c, r]) => {
        if (active) {
          setEligibility(e);
          setCatalog(c);
          setItems(r.items);
          setTotal(r.total);
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
  }, [page, status, revision]);
  return (
    <Surface aria-label="题目投稿页面">
      <PageHeading>
        <h1>题目投稿</h1>
        <Space>
          <Button
            icon={<RefreshCw size={16} />}
            onClick={refresh}
            loading={loading}
          >
            刷新
          </Button>
          <Button
            type="primary"
            icon={<Plus size={16} />}
            disabled={!eligibility?.eligible || !catalog}
            onClick={() => setEditor({})}
          >
            提交题目
          </Button>
        </Space>
      </PageHeading>
      {error && (
        <Alert
          type="error"
          showIcon
          title={error}
          action={<Button onClick={refresh}>重试</Button>}
        />
      )}
      <Card
        size="small"
        className="submission-eligibility"
        title={eligibility?.eligible ? "已具备投稿资格" : "投稿资格"}
        loading={!eligibility && loading}
      >
        <div className="submission-eligibility-grid">
          <div className="submission-age">
            <Typography.Text type="secondary">注册时间</Typography.Text>
            <div className="submission-age-value">
              {eligibility?.ageEligible ? "已超过 7 天" : "需注册超过 7 天"}
            </div>
          </div>
          <div className="submission-progress">
            <div className="submission-progress-heading">
              <span>首次答对不同题目</span>
              <strong>
                {eligibility ? `${eligibility.firstTryCorrect} / 50` : "— / 50"}
              </strong>
            </div>
            <Progress
              percent={Math.min(100, (eligibility?.firstTryCorrect ?? 0) * 2)}
              showInfo={false}
            />
          </div>
        </div>
      </Card>
      <div className="submission-history-heading">
        <h2>我的投稿</h2>
        <Select
          aria-label="投稿状态"
          value={status}
          onChange={(s) => {
            setStatus(s);
            setPage(1);
          }}
          className="submission-status"
          options={[{ value: "all", label: "全部状态" }, ...submissionStatuses]}
        />
      </div>
      <Table<PartySubmission>
        rowKey="id"
        dataSource={items}
        loading={loading}
        scroll={{ x: 700 }}
        locale={{ emptyText: <Empty description="还没有投稿" /> }}
        pagination={{
          current: page,
          total,
          pageSize: 20,
          showSizeChanger: false,
          onChange: setPage,
        }}
        columns={[
          { title: "答案", key: "answer", render: (_, r) => r.draft.answer },
          { title: "分类", dataIndex: "categoryPath" },
          {
            title: "状态",
            key: "status",
            render: (_, r) => <SubmissionStatus status={r.status} />,
          },
          {
            title: "提交时间",
            dataIndex: "createdAt",
            render: (v) => new Date(v).toLocaleString(),
          },
          {
            title: "操作",
            key: "actions",
            render: (_, r) => (
              <Button type="link" onClick={() => setDetail(r)}>
                查看
              </Button>
            ),
          },
        ]}
      />
      {editDialog.value && catalog && (
        <SubmissionEditor
          target={editDialog.value}
          categories={catalog.categories}
          open={editDialog.open}
          afterClose={editDialog.afterClose}
          onClose={() => setEditor(undefined)}
          onSaved={() => {
            const target = editDialog.value;
            setEditor((current) => (current === target ? undefined : current));
            refresh();
            void message.success("题目已提交审核");
          }}
        />
      )}
      {detailDialog.value && (
        <SubmissionDetail
          item={detailDialog.value}
          open={detailDialog.open}
          afterClose={detailDialog.afterClose}
          onClose={() => setDetail(undefined)}
          onEdit={(item) => {
            setDetail(undefined);
            setEditor({ item });
          }}
          onChanged={refresh}
        />
      )}
    </Surface>
  );
}
function SubmissionEditor({
  target,
  categories,
  open,
  afterClose,
  onClose,
  onSaved,
}: {
  target: { item?: PartySubmission };
  categories: PartyCatalog["categories"];
  open: boolean;
  afterClose(): void;
  onClose(): void;
  onSaved(): void;
}) {
  const [form] = Form.useForm<PartySubmissionDraft>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string>();
  useEffect(() => {
    form.setFieldsValue(structuredClone(target.item?.draft ?? newQuestion));
    setError(undefined);
    setBusy(false);
  }, [target, form]);
  const mounted = useRef(true),
    context = useRef({ target, open });
  context.current = { target, open };
  const current = () =>
    mounted.current &&
    context.current.target === target &&
    context.current.open;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function save() {
    const values = await form.validateFields().catch(() => undefined);
    if (!values) return;
    const parsed = partySubmissionDraft.safeParse(values);
    if (!parsed.success) {
      setError("请填写完整的题目及三个提示");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      if (target.item)
        unwrap(
          await api.PATCH("/api/v1/party-submissions/{id}", {
            params: { path: { id: target.item.id } },
            body: { ...parsed.data, version: target.item.version },
          }),
        );
      else
        unwrap(
          await api.POST("/api/v1/party-submissions", { body: parsed.data }),
        );
      onSaved();
    } catch (e) {
      if (current()) setError(errorText(e));
    } finally {
      if (current()) setBusy(false);
    }
  }
  return (
    <Modal
      title={target.item ? "修改投稿" : "提交题目"}
      open={open}
      afterClose={afterClose}
      onCancel={onClose}
      width={640}
      footer={
        <Space>
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" loading={busy} onClick={() => void save()}>
            提交审核
          </Button>
        </Space>
      }
    >
      {error && (
        <Alert
          type="error"
          title={error}
          showIcon
          style={{ marginBottom: 16 }}
        />
      )}
      <Form form={form} layout="vertical" disabled={busy}>
        <QuestionFields categories={categories} />
      </Form>
    </Modal>
  );
}
function SubmissionDetail({
  item: initial,
  open,
  afterClose,
  onClose,
  onEdit,
  onChanged,
}: {
  item: PartySubmission;
  open: boolean;
  afterClose(): void;
  onClose(): void;
  onEdit(item: PartySubmission): void;
  onChanged(item: PartySubmission): void;
}) {
  const [item, setItem] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string>();
  const mounted = useRef(true),
    visible = useRef(open);
  visible.current = open;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => setError(undefined), [item]);
  return (
    <Modal
      title="投稿详情"
      open={open}
      afterClose={afterClose}
      onCancel={onClose}
      footer={
        <Space>
          <Button onClick={onClose}>关闭</Button>
          {item.status === "pending" && (
            <Button
              loading={busy}
              onClick={() => {
                setBusy(true);
                void api
                  .POST("/api/v1/party-submissions/{id}/withdraw", {
                    params: { path: { id: item.id } },
                    body: { version: item.version },
                  })
                  .then(unwrap)
                  .then((r) => {
                    if (mounted.current && visible.current) setItem(r);
                    onChanged(r);
                  })
                  .catch((e) => {
                    if (mounted.current && visible.current)
                      setError(errorText(e));
                  })
                  .finally(() => {
                    if (mounted.current && visible.current) setBusy(false);
                  });
              }}
            >
              撤回投稿
            </Button>
          )}
          {item.status !== "approved" && (
            <Button type="primary" disabled={busy} onClick={() => onEdit(item)}>
              {item.status === "pending" ? "修改投稿" : "修改后提交"}
            </Button>
          )}
        </Space>
      }
    >
      <Space style={{ marginBottom: 16 }}>
        <SubmissionStatus status={item.status} />
        {item.reviewedAt && (
          <Typography.Text type="secondary">
            {new Date(item.reviewedAt).toLocaleString()}
          </Typography.Text>
        )}
      </Space>
      {error && (
        <Alert type="error" title={error} style={{ marginBottom: 16 }} />
      )}
      {item.reason && (
        <Alert
          type="warning"
          title="驳回原因"
          description={item.reason}
          style={{ marginBottom: 16 }}
        />
      )}
      <QuestionReadout
        draft={item.reviewedDraft ?? item.draft}
        path={item.reviewedCategoryPath ?? item.categoryPath}
      />
      {item.reviewedDraft &&
        JSON.stringify(item.draft) !== JSON.stringify(item.reviewedDraft) && (
          <>
            <Divider>原始投稿</Divider>
            <QuestionReadout draft={item.draft} path={item.categoryPath} />
          </>
        )}
    </Modal>
  );
}
