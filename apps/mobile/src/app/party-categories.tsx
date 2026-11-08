import { useEffect, useRef, useState } from "react";
import { View, Switch } from "react-native";
import { useNavigation } from "expo-router";
import {
  partyCategoryBranches,
  partyCategoryStats,
  type ActivitySnapshot,
  type PartyCatalog,
} from "@cinegather/contracts";
import { activities } from "../activities";
import { useActivities } from "../components/Activities";
import { useSession, action } from "../components/use-runtime";
import { loadPartyCatalog } from "../components/PartyCategories";
import { Sheet, closeSheet } from "../components/Sheet";
import { Button, Label, styles } from "../components/ui";
export default function PartyCategories() {
  const navigation = useNavigation(),
    { snapshot } = useActivities(),
    userId = useSession().user?.id;
  const retained = useRef<ActivitySnapshot | undefined>(undefined);
  if (!retained.current && snapshot?.game)
    retained.current = structuredClone(snapshot);
  const context = retained.current,
    game = context?.game;
  const [catalog, setCatalog] = useState<PartyCatalog>(),
    [ids, setIds] = useState<string[]>([]),
    [saving, setSaving] = useState(false),
    [removed, setRemoved] = useState(false);
  useEffect(() => {
    let active = true;
    if (context && game)
      void loadPartyCatalog(context.roomId)
        .then((c) => {
          if (active) {
            setCatalog(c);
            const selection = game.categorySelection?.categoryIds ?? null;
            const selected = partyCategoryStats(
              c.categories,
              selection,
              game.kind,
            ).categoryIds;
            setIds(selected);
            setRemoved(
              selection !== null && selection.length !== selected.length,
            );
          }
        })
        .catch((e) => {
          if (active)
            void action(async () => {
              throw e;
            })();
        });
    return () => {
      active = false;
    };
  }, [context, game]);
  const stats =
    catalog && game
      ? partyCategoryStats(catalog.categories, ids, game.kind)
      : undefined;
  function toggle(branch: string[], checked: boolean) {
    setIds((old) =>
      checked
        ? [...new Set([...old, ...branch])]
        : old.filter((id) => !branch.includes(id)),
    );
  }
  const controlled =
    context?.ownerId === userId || context?.starterId === userId;
  return (
    <Sheet
      title="选择题目分类"
      footer={
        <Button
          primary
          disabled={!catalog || saving || !controlled}
          onPress={action(async () => {
            if (!context || !game || saving) return;
            setSaving(true);
            try {
              activities.assertContext(context);
              await activities.command(
                {
                  type: "party",
                  generation: context.generation,
                  action: {
                    type: "categories",
                    categoryIds: ids,
                    selectionVersion: game.categorySelection?.version ?? 0,
                  },
                },
                context,
              );
              if (navigation.isFocused()) closeSheet();
            } finally {
              setSaving(false);
            }
          })}
        >
          保存选择
        </Button>
      }
    >
      {removed && (
        <Label>
          部分分类已停用、移除或没有当前玩法的题目，已取消选中，请确认后保存。
        </Label>
      )}
      <Label>
        {stats
          ? `${stats.categoryCount} 个分类，${stats.questionCount} 道可用题`
          : "正在读取题库分类…"}
      </Label>
      {catalog &&
        game &&
        stats &&
        (stats.questionCount < catalog.policy[game.kind].minQuestions ||
          stats.categoryCount < catalog.policy[game.kind].minCategories) && (
          <Label>
            至少需要 {catalog.policy[game.kind].minQuestions} 道题
            {catalog.policy[game.kind].minCategories
              ? `、${catalog.policy[game.kind].minCategories} 个分类`
              : ""}
          </Label>
        )}
      {catalog &&
        game &&
        catalog.categories
          .filter((c) => !c.parentId)
          .map((root) => {
            const branch = partyCategoryStats(
                catalog.categories,
                partyCategoryBranches(catalog.categories, root.id),
                game.kind,
              ),
              children = catalog.categories.filter(
                (c) => c.parentId === root.id,
              );
            return (
              <View key={root.id} style={{ gap: 10 }}>
                <View style={styles.spread}>
                  <Label>
                    {root.name}（{branch.questionCount} 题）
                  </Label>
                  <Switch
                    accessibilityLabel={`选择${root.name}全部题目`}
                    disabled={saving || !branch.questionCount}
                    value={
                      !!branch.categoryIds.length &&
                      branch.categoryIds.every((id) => ids.includes(id))
                    }
                    onValueChange={(checked) =>
                      toggle(branch.categoryIds, checked)
                    }
                  />
                </View>
                {children.length > 0 &&
                  [root, ...children].map((c) => {
                    const stat = partyCategoryStats(
                      catalog.categories,
                      [c.id],
                      game.kind,
                    );
                    if (c.id === root.id && !stat.questionCount) return null;
                    return (
                      <View
                        key={c.id}
                        style={[styles.spread, { paddingLeft: 16 }]}
                      >
                        <Label muted>
                          {c.id === root.id ? "本类题目" : c.name}（
                          {stat.questionCount} 题）
                        </Label>
                        <Switch
                          accessibilityLabel={`选择${c.id === root.id ? root.name + "本类题目" : c.name}`}
                          disabled={saving || !stat.questionCount}
                          value={ids.includes(c.id)}
                          onValueChange={(checked) => toggle([c.id], checked)}
                        />
                      </View>
                    );
                  })}
              </View>
            );
          })}
    </Sheet>
  );
}
