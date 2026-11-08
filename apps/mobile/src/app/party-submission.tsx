import { useCallback, useState } from "react";
import { View } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import {
  partySubmissionSchema,
  type PartySubmission,
} from "@cinegather/contracts";
import { runtime } from "../runtime";
import { Screen } from "../components/Screen";
import { Button, Label, styles } from "../components/ui";
import {
  QuestionContent,
  submissionStatusNames,
} from "../components/QuestionSubmissions";
export default function SubmissionDetail() {
  const { id } = useLocalSearchParams<{ id: string }>(),
    [item, setItem] = useState<PartySubmission>(),
    [error, setError] = useState<string>(),
    [revision, setRevision] = useState(0);
  useFocusEffect(
    useCallback(() => {
      let active = true;
      setError(undefined);
      void runtime.api
        .call("submission", (c) =>
          c.GET("/api/v1/party-submissions/{id}", { params: { path: { id } } }),
        )
        .then((r) => {
          if (active) setItem(partySubmissionSchema.parse(r));
        })
        .catch((e) => {
          if (active) setError(e instanceof Error ? e.message : "无法加载投稿");
        });
      return () => {
        active = false;
      };
    }, [id, revision]),
  );
  return (
    <Screen title="投稿详情" back>
      {error && (
        <View style={styles.card}>
          <Label>{error}</Label>
          <Button onPress={() => setRevision((n) => n + 1)}>重新加载</Button>
        </View>
      )}
      {!item && !error && <Label muted>正在读取投稿…</Label>}
      {item && (
        <>
          <Label>{submissionStatusNames[item.status]}</Label>
          <Label muted>{new Date(item.createdAt).toLocaleString()}</Label>
          {item.reason && (
            <View style={styles.card}>
              <Label>驳回原因</Label>
              <Label>{item.reason}</Label>
            </View>
          )}
          <QuestionContent
            draft={item.reviewedDraft ?? item.draft}
            path={item.reviewedCategoryPath ?? item.categoryPath}
          />
          {item.reviewedDraft &&
            JSON.stringify(item.reviewedDraft) !==
              JSON.stringify(item.draft) && (
              <>
                <Label>原始投稿</Label>
                <QuestionContent draft={item.draft} path={item.categoryPath} />
              </>
            )}
          {item.status !== "approved" && (
            <Button
              primary
              onPress={() =>
                router.push({
                  pathname: "/submit-question",
                  params: { id: item.id },
                })
              }
            >
              {item.status === "pending" ? "修改投稿" : "修改后提交"}
            </Button>
          )}
          {item.status === "pending" && (
            <Button
              onPress={async () => {
                const r = await runtime.api.call("withdraw-submission", (c) =>
                  c.POST("/api/v1/party-submissions/{id}/withdraw", {
                    params: { path: { id: item.id } },
                    body: { version: item.version },
                  }),
                );
                setItem(partySubmissionSchema.parse(r));
                runtime.feedback.show({ text: "投稿已撤回", tone: "success" });
              }}
            >
              撤回投稿
            </Button>
          )}
        </>
      )}
    </Screen>
  );
}
