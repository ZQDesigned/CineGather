import { View } from "react-native";
import {
  type PartySubmission,
  type PartySubmissionDraft,
  type SubmissionEligibility,
} from "@cinegather/contracts";
import { Label, styles } from "./ui";
export const submissionStatusNames: Record<PartySubmission["status"], string> =
  {
    pending: "待审核",
    approved: "已收录",
    rejected: "已驳回",
    withdrawn: "已撤回",
  };
export function QuestionProgress({ value }: { value: SubmissionEligibility }) {
  return (
    <View style={styles.card}>
      <Label>{value.eligible ? "已具备投稿资格" : "投稿资格"}</Label>
      <Label>{value.ageEligible ? "注册已超过 7 天" : "需注册超过 7 天"}</Label>
      <Label>首次答对不同题目：{value.firstTryCorrect} / 50</Label>
    </View>
  );
}
export function QuestionContent({
  draft,
  path,
}: {
  draft: PartySubmissionDraft;
  path: string;
}) {
  return (
    <View style={styles.card}>
      <Label>答案：{draft.answer}</Label>
      <Label muted>{path || "分类已移除"}</Label>
      <Label muted>
        {draft.modes
          .map((m) => (m === "draw" ? "你画我猜" : "猜词抢答"))
          .join("、")}
      </Label>
      {draft.clues.map((c, i) => (
        <Label key={i}>
          提示 {i + 1}：{c}
        </Label>
      ))}
    </View>
  );
}
