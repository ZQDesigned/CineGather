import { Checkbox, Descriptions, Form, Input, Tag, TreeSelect } from "antd";
import {
  partyCategoryPath,
  type PartyCategory,
  type PartySubmission,
  type PartySubmissionDraft,
} from "@cinegather/contracts";
export const submissionStatuses = [
  { value: "pending", label: "待审核", color: "processing" },
  { value: "approved", label: "已收录", color: "success" },
  { value: "rejected", label: "已驳回", color: "error" },
  { value: "withdrawn", label: "已撤回", color: "default" },
] as const;
export function SubmissionStatus({
  status,
}: {
  status: PartySubmission["status"];
}) {
  const option = submissionStatuses.find((s) => s.value === status)!;
  return <Tag color={option.color}>{option.label}</Tag>;
}
export const newQuestion: PartySubmissionDraft = {
  answer: "",
  categoryId: "",
  clues: ["", "", ""],
  modes: ["draw", "quiz"],
};
export const questionModes = [
  { label: "你画我猜", value: "draw" },
  { label: "猜词抢答", value: "quiz" },
];
export function QuestionFields({
  categories,
  disabled,
}: {
  categories: PartyCategory[];
  disabled?: boolean;
}) {
  const form = Form.useFormInstance(),
    selected = Form.useWatch("categoryId", form);
  const available = (c: PartyCategory) =>
    c.enabled &&
    (!c.parentId || categories.some((p) => p.id === c.parentId && p.enabled));
  const node = (c: PartyCategory) => ({
    value: c.id,
    title: c.name + (!available(c) ? "（已停用）" : ""),
    path:
      partyCategoryPath(categories, c.id) + (!available(c) ? "（已停用）" : ""),
    disabled: !available(c),
  });
  const tree = categories
    .filter((c) => !c.parentId)
    .map((c) => ({
      ...node(c),
      children: categories.filter((p) => p.parentId === c.id).map(node),
    }));
  if (selected && !categories.some((c) => c.id === selected))
    tree.push({
      value: selected,
      title: "分类已移除，请重新选择",
      path: "分类已移除，请重新选择",
      disabled: true,
      children: [],
    });
  return (
    <>
      <Form.Item
        label="答案"
        name="answer"
        rules={[
          { required: true, whitespace: true, message: "请输入答案" },
          { max: 40 },
        ]}
      >
        <Input maxLength={40} showCount disabled={disabled} />
      </Form.Item>
      <Form.Item
        label="题目分类"
        name="categoryId"
        rules={[
          { required: true, message: "请选择分类" },
          {
            validator: (_, value) =>
              categories.some((c) => c.id === value && available(c))
                ? Promise.resolve()
                : Promise.reject(Error("请选择可用分类")),
          },
        ]}
      >
        <TreeSelect
          aria-label="题目分类"
          disabled={disabled}
          placeholder="选择一级或二级分类"
          treeDefaultExpandAll
          treeLine
          showSearch={{ treeNodeFilterProp: "path" }}
          treeNodeLabelProp="path"
          treeData={tree}
        />
      </Form.Item>
      <Form.Item
        label="适用玩法"
        name="modes"
        rules={[{ type: "array", min: 1, message: "至少选择一种玩法" }]}
      >
        <Checkbox.Group disabled={disabled} options={questionModes} />
      </Form.Item>
      {[0, 1, 2].map((i) => (
        <Form.Item
          key={i}
          label={`提示 ${i + 1}`}
          name={["clues", i]}
          rules={[
            { required: true, whitespace: true, message: "请输入递进提示" },
            { max: 160 },
          ]}
        >
          <Input.TextArea
            disabled={disabled}
            rows={2}
            maxLength={160}
            showCount
            placeholder={
              i === 0 ? "从宽泛线索逐步指向答案，避免重复分类名称" : undefined
            }
          />
        </Form.Item>
      ))}
    </>
  );
}
export function QuestionReadout({
  draft,
  path,
}: {
  draft: PartySubmissionDraft;
  path: string;
}) {
  return (
    <Descriptions
      column={1}
      size="small"
      items={[
        { key: "answer", label: "答案", children: draft.answer },
        { key: "category", label: "分类", children: path || "分类已移除" },
        {
          key: "modes",
          label: "适用玩法",
          children: draft.modes
            .map((m) => (m === "draw" ? "你画我猜" : "猜词抢答"))
            .join("、"),
        },
        ...draft.clues.map((c, i) => ({
          key: `clue${i}`,
          label: `提示 ${i + 1}`,
          children: c,
        })),
      ]}
    />
  );
}
