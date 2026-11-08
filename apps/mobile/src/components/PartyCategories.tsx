import { useEffect, useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import {
  partyCatalogSchema,
  partyCategoryStats,
  type ActivitySnapshot,
  type PartyCatalog,
} from "@cinegather/contracts";
import { runtime } from "../runtime";
import { Button, Label } from "./ui";
export async function loadPartyCatalog(roomId: string) {
  return partyCatalogSchema.parse(
    await runtime.api.call("party-categories", (c) =>
      c.GET("/api/v1/rooms/{roomId}/activity/categories", {
        params: { path: { roomId } },
      }),
    ),
  );
}
export function PartyCategorySummary({
  snapshot,
  controlled,
  onAvailability,
}: {
  snapshot: ActivitySnapshot;
  controlled: boolean;
  onAvailability(allowed: boolean): void;
}) {
  const game = snapshot.game!;
  const [catalog, setCatalog] = useState<PartyCatalog>();
  const version = game.categorySelection?.version ?? 0;
  useEffect(() => {
    let active = true;
    setCatalog(undefined);
    void loadPartyCatalog(snapshot.roomId)
      .then((c) => {
        if (active) setCatalog(c);
      })
      .catch((e) => {
        if (active)
          runtime.feedback.show({
            text: e instanceof Error ? e.message : "无法读取题库分类",
          });
      });
    return () => {
      active = false;
    };
  }, [snapshot.roomId, snapshot.generation, game.kind, game.phase, version]);
  const stats = catalog
      ? partyCategoryStats(
          catalog.categories,
          game.categorySelection?.categoryIds ?? null,
          game.kind,
        )
      : undefined,
    rule = catalog?.policy[game.kind];
  const allowed =
    !!stats &&
    !!rule &&
    stats.questionCount >= rule.minQuestions &&
    stats.categoryCount >= rule.minCategories;
  useEffect(() => {
    onAvailability(allowed);
  }, [allowed, onAvailability]);
  return (
    <View style={{ gap: 8 }}>
      <Label muted>
        {stats
          ? `已选 ${stats.categoryCount} 个分类，共 ${stats.questionCount} 道可用题`
          : "正在读取题库分类…"}
      </Label>
      {stats && rule && !allowed && (
        <Label>
          至少需要 {rule.minQuestions} 道题
          {rule.minCategories ? `、${rule.minCategories} 个分类` : ""}
        </Label>
      )}
      {controlled && (
        <Button
          onPress={() =>
            router.push({
              pathname: "/party-categories",
              params: { roomId: snapshot.roomId },
            })
          }
        >
          选择分类
        </Button>
      )}
    </View>
  );
}
