import { useCallback, useRef, useState } from "react";
import { ScrollView, Switch, View } from "react-native";
import {
  useFocusEffect,
  useLocalSearchParams,
  useNavigation,
} from "expo-router";
import {
  partyCatalogSchema,
  partyCategoryPath,
  partySubmissionDraft,
  partySubmissionSchema,
  submissionEligibilitySchema,
  type PartyCatalog,
  type PartySubmission,
  type PartySubmissionDraft,
} from "@cinegather/contracts";
import { runtime } from "../runtime";
import { Sheet, closeSheet } from "../components/Sheet";
import { Button, Field, Label, styles } from "../components/ui";
export default function SubmitQuestion() {
  const params = useLocalSearchParams<{ id?: string }>(),
    id = useRef(params.id).current,
    navigation = useNavigation();
  const [draft, setDraft] = useState<PartySubmissionDraft>({
      answer: "",
      categoryId: "",
      clues: ["", "", ""],
      modes: ["draw", "quiz"],
    }),
    [item, setItem] = useState<PartySubmission>(),
    [catalog, setCatalog] = useState<PartyCatalog>(),
    [ready, setReady] = useState(false),
    [error, setError] = useState<string>(),
    [categoriesOpen, setCategoriesOpen] = useState(false),
    [q, setQ] = useState(""),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0);
  useFocusEffect(
    useCallback(() => {
      let active = true;
      setReady(false);
      void Promise.all([
        runtime.api.call("submission-catalog", (c) =>
          c.GET("/api/v1/party-submissions/catalog"),
        ),
        runtime.api.call("submission-eligibility", (c) =>
          c.GET("/api/v1/party-submissions/eligibility"),
        ),
        id
          ? runtime.api.call("submission", (c) =>
              c.GET("/api/v1/party-submissions/{id}", {
                params: { path: { id } },
              }),
            )
          : Promise.resolve(undefined),
      ])
        .then(([c, e, r]) => {
          if (!active) return;
          setCatalog(partyCatalogSchema.parse(c));
          const eligibility = submissionEligibilitySchema.parse(e);
          if (!eligibility.eligible)
            throw Error("注册超过 7 天且首次答对 50 道不同题目后可投稿");
          if (r) {
            const s = partySubmissionSchema.parse(r);
            if (s.status === "approved") throw Error("已收录的投稿不能修改");
            setItem(s);
            setDraft(structuredClone(s.draft));
          }
          setReady(true);
          setError(undefined);
        })
        .catch((e) => {
          if (active)
            setError(e instanceof Error ? e.message : "无法加载投稿表单");
        });
      return () => {
        active = false;
      };
    }, [id, revision]),
  );
  const allowed =
    catalog?.categories.filter(
      (c) =>
        c.enabled &&
        (!c.parentId ||
          catalog.categories.some((p) => p.id === c.parentId && p.enabled)),
    ) ?? [];
  const selectedPath = partyCategoryPath(allowed, draft.categoryId);
  function update<K extends keyof PartySubmissionDraft>(
    key: K,
    value: PartySubmissionDraft[K],
  ) {
    setDraft((old) => ({ ...old, [key]: value }));
  }
  async function save() {
    const parsed = partySubmissionDraft.safeParse(draft);
    if (!parsed.success) {
      setError("请填写答案、分类、三个提示，并至少选择一种玩法");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      if (item)
        await runtime.api.call("edit-submission", (c) =>
          c.PATCH("/api/v1/party-submissions/{id}", {
            params: { path: { id: item.id } },
            body: { ...parsed.data, version: item.version },
          }),
        );
      else
        await runtime.api.call("submit-question", (c) =>
          c.POST("/api/v1/party-submissions", { body: parsed.data }),
        );
      runtime.feedback.show({ text: "题目已提交审核", tone: "success" });
      if (navigation.isFocused()) closeSheet();
    } catch (e) {
      if (navigation.isFocused()) runtime.fail(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet
      title={id ? "修改投稿" : "提交题目"}
      footer={
        <Button primary disabled={!ready || busy} onPress={save}>
          提交审核
        </Button>
      }
    >
      {error && (
        <View style={styles.card}>
          <Label>{error}</Label>
          {!ready && (
            <Button onPress={() => setRevision((n) => n + 1)}>重新加载</Button>
          )}
        </View>
      )}
      {!catalog && !error && <Label muted>正在读取题库分类…</Label>}
      <Field
        label="答案"
        value={draft.answer}
        maxLength={40}
        editable={ready && !busy}
        onChangeText={(v) => update("answer", v)}
      />
      <Label>题目分类</Label>
      <Button
        disabled={!ready || busy}
        onPress={() => setCategoriesOpen((v) => !v)}
      >
        {selectedPath || "选择一级或二级分类"}
      </Button>
      {categoriesOpen && (
        <View style={styles.card}>
          <Field label="搜索分类" value={q} onChangeText={setQ} />
          <ScrollView nestedScrollEnabled style={{ maxHeight: 280 }}>
            {allowed
              .filter((c) => !c.parentId)
              .map((root) => {
                const branch = [
                  root,
                  ...allowed.filter((c) => c.parentId === root.id),
                ].filter((c) => partyCategoryPath(allowed, c.id).includes(q));
                return branch.length ? (
                  <View key={root.id} style={{ gap: 4, marginBottom: 12 }}>
                    {branch.map((c) => (
                      <Button
                        key={c.id}
                        quiet
                        disabled={busy}
                        onPress={() => {
                          update("categoryId", c.id);
                          setCategoriesOpen(false);
                        }}
                      >{`${c.parentId ? "　" : ""}${c.name}${c.id === draft.categoryId ? " ✓" : ""}`}</Button>
                    ))}
                  </View>
                ) : null;
              })}
          </ScrollView>
        </View>
      )}
      <Label>适用玩法</Label>
      {(["draw", "quiz"] as const).map((mode) => (
        <View key={mode} style={styles.spread}>
          <Label>{mode === "draw" ? "你画我猜" : "猜词抢答"}</Label>
          <Switch
            accessibilityLabel={mode === "draw" ? "你画我猜" : "猜词抢答"}
            disabled={!ready || busy}
            value={draft.modes.includes(mode)}
            onValueChange={(v) =>
              update(
                "modes",
                v
                  ? [...draft.modes, mode]
                  : draft.modes.filter((m) => m !== mode),
              )
            }
          />
        </View>
      ))}
      {[0, 1, 2].map((i) => (
        <Field
          key={i}
          label={`提示 ${i + 1}`}
          multiline
          numberOfLines={2}
          maxLength={160}
          value={draft.clues[i]}
          editable={ready && !busy}
          onChangeText={(v) =>
            update(
              "clues",
              draft.clues.map((old, index) => (index === i ? v : old)),
            )
          }
        />
      ))}
      <Label muted>提示应逐步指向答案，避免重复分类名称。</Label>
    </Sheet>
  );
}
