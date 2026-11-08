import { useCallback, useState } from "react";
import { FilePenLine } from "lucide-react-native";
import { View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import {
  partySubmissionsSchema,
  submissionEligibilitySchema,
  type PartySubmission,
  type SubmissionEligibility,
} from "@cinegather/contracts";
import { runtime } from "../runtime";
import { Screen } from "../components/Screen";
import { Button, Label, MenuRow, styles } from "../components/ui";
import {
  QuestionProgress,
  submissionStatusNames,
} from "../components/QuestionSubmissions";
export default function Submissions() {
  const [eligibility, setEligibility] = useState<SubmissionEligibility>(),
    [items, setItems] = useState<PartySubmission[]>([]),
    [total, setTotal] = useState(0),
    [page, setPage] = useState(1),
    [revision, setRevision] = useState(0),
    [error, setError] = useState<string>(),
    [loading, setLoading] = useState(true);
  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      setError(undefined);
      void Promise.all([
        runtime.api
          .call("submission-eligibility", (c) =>
            c.GET("/api/v1/party-submissions/eligibility"),
          )
          .then((v) => submissionEligibilitySchema.parse(v)),
        runtime.api
          .call("submissions", (c) =>
            c.GET("/api/v1/party-submissions", {
              params: { query: { page, pageSize: 20 } },
            }),
          )
          .then((v) => partySubmissionsSchema.parse(v)),
      ])
        .then(([e, r]) => {
          if (active) {
            setEligibility(e);
            setItems(r.items);
            setTotal(r.total);
            if (page > 1 && !r.items.length)
              setPage(Math.max(1, Math.ceil(r.total / 20)));
          }
        })
        .catch((e) => {
          if (active) setError(e instanceof Error ? e.message : "无法加载投稿");
        })
        .finally(() => {
          if (active) setLoading(false);
        });
      return () => {
        active = false;
      };
    }, [page, revision]),
  );
  return (
    <Screen title="题目投稿" back>
      {eligibility && <QuestionProgress value={eligibility} />}
      {error && (
        <View style={styles.card}>
          <Label>{error}</Label>
          <Button onPress={() => setRevision((n) => n + 1)}>重试</Button>
        </View>
      )}
      <Button
        primary
        disabled={!eligibility?.eligible || loading}
        onPress={() => router.push("/submit-question")}
      >
        提交题目
      </Button>
      <View style={styles.spread}>
        <Label>我的投稿（{total}）</Label>
        <Button quiet onPress={() => setRevision((n) => n + 1)}>
          刷新
        </Button>
      </View>
      {!items.length && (
        <Label muted>{loading ? "正在读取投稿…" : "还没有投稿"}</Label>
      )}
      {!!items.length && (
        <View style={styles.group}>
          {items.map((item, i) => (
            <MenuRow
              icon={FilePenLine}
              key={item.id}
              title={item.draft.answer}
              detail={`${submissionStatusNames[item.status]}  ${item.categoryPath}`}
              last={i === items.length - 1}
              onPress={() =>
                router.push({
                  pathname: "/party-submission",
                  params: { id: item.id },
                })
              }
            />
          ))}
        </View>
      )}
      {total > 20 && (
        <View style={styles.spread}>
          <Button
            disabled={page <= 1 || loading}
            onPress={() => setPage((p) => p - 1)}
          >
            上一页
          </Button>
          <Label>
            {page} / {Math.ceil(total / 20)}
          </Label>
          <Button
            disabled={page * 20 >= total || loading}
            onPress={() => setPage((p) => p + 1)}
          >
            下一页
          </Button>
        </View>
      )}
    </Screen>
  );
}
