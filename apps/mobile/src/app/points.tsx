import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { Coins } from "lucide-react-native";
import {
  pointsSummarySchema,
  pointsListSchema,
  type PointsSummary,
  type PointsEntry,
} from "@cinegather/contracts";
import { pointsGameName, pointsReason } from "@cinegather/client-core";
import { runtime } from "../runtime";
import { Screen } from "../components/Screen";
import { Button, Label, MenuRow, styles, colors } from "../components/ui";
export default function Points() {
  const [summary, setSummary] = useState<PointsSummary>(),
    [items, setItems] = useState<PointsEntry[]>([]),
    [page, setPage] = useState(1),
    [total, setTotal] = useState(0),
    [error, setError] = useState<string>(),
    [revision, setRevision] = useState(0),
    [loading, setLoading] = useState(false);
  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      setError(undefined);
      void Promise.all([
        runtime.api
          .call("points", (c) => c.GET("/api/v1/points"))
          .then((r) => pointsSummarySchema.parse(r)),
        runtime.api
          .call("points-ledger", (c) =>
            c.GET("/api/v1/points/ledger", {
              params: { query: { page, pageSize: 20 } },
            }),
          )
          .then((r) => pointsListSchema.parse(r)),
      ])
        .then(([s, r]) => {
          if (active) {
            setSummary(s);
            setItems(r.items);
            setTotal(r.total);
          }
        })
        .catch((e) => {
          if (active) setError(e instanceof Error ? e.message : "无法读取积分");
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
    <Screen
      title="我的积分"
      back
      actions={
        <Button quiet onPress={() => router.push("/points-rules")}>
          规则
        </Button>
      }
    >
      {error && (
        <View style={styles.card}>
          <Label>{error}</Label>
          <Button onPress={() => setRevision((n) => n + 1)}>重试</Button>
        </View>
      )}
      <View style={styles.card}>
        <Label muted>可用积分</Label>
        <Text
          style={{
            fontSize: 40,
            lineHeight: 50,
            fontWeight: "700",
            color: colors.text,
          }}
        >
          {summary?.balance ?? "—"}
        </Text>
        <View style={styles.spread}>
          <Label>
            今日 {summary?.todayEarned ?? 0} / {summary?.dailyCap ?? "—"}
          </Label>
          <Label muted>
            {summary?.enabled === false
              ? "发放已暂停"
              : `还可获得 ${summary?.remaining ?? 0}`}
          </Label>
        </View>
        <Label muted>每日额度按北京时间 00:00 刷新</Label>
      </View>
      <View style={styles.spread}>
        <Label>积分明细（{total}）</Label>
        <Button
          quiet
          disabled={loading}
          onPress={() => setRevision((n) => n + 1)}
        >
          刷新
        </Button>
      </View>
      {!!items.length && (
        <View style={styles.group}>
          {items.map((e, i) => (
            <MenuRow
              key={e.id}
              icon={Coins}
              title={`${pointsGameName(e.game)} +${e.amount}`}
              detail={`${pointsReason(e)}\n${new Date(e.createdAt).toLocaleString()}`}
              last={i === items.length - 1}
              onPress={() =>
                router.push({ pathname: "/points-entry", params: { id: e.id } })
              }
            />
          ))}
        </View>
      )}
      {!items.length && (
        <Label muted>{loading ? "正在读取积分…" : "还没有积分记录"}</Label>
      )}
      {total > 20 && (
        <View style={styles.spread}>
          <Button
            disabled={page === 1 || loading}
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
