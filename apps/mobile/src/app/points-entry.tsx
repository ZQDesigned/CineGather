import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { pointsEntrySchema, type PointsEntry } from "@cinegather/contracts";
import { pointsGameName, pointsReason } from "@cinegather/client-core";
import { runtime } from "../runtime";
import { Screen } from "../components/Screen";
import { Button, Label, styles, colors } from "../components/ui";
export default function PointsEntryPage() {
  const { id } = useLocalSearchParams<{ id: string }>(),
    [entry, setEntry] = useState<PointsEntry>(),
    [error, setError] = useState<string>(),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setError(undefined);
    setEntry(undefined);
    void runtime.api
      .call("points-entry", (c) =>
        c.GET("/api/v1/points/ledger/{id}", { params: { path: { id } } }),
      )
      .then((r) => {
        if (active) setEntry(pointsEntrySchema.parse(r));
      })
      .catch((e) => {
        if (active)
          setError(e instanceof Error ? e.message : "无法读取积分记录");
      });
    return () => {
      active = false;
    };
  }, [id, revision]);
  return (
    <Screen title="积分明细" back>
      {error && (
        <View style={styles.card}>
          <Label>{error}</Label>
          <Button onPress={() => setRevision((n) => n + 1)}>重试</Button>
        </View>
      )}
      {!entry && !error && <Label muted>正在读取记录…</Label>}
      {entry && (
        <View style={styles.card}>
          <Text style={{ fontSize: 36, lineHeight: 46, color: colors.text }}>
            +{entry.amount} 积分
          </Text>
          <Label>{pointsGameName(entry.game)}</Label>
          <Label>{pointsReason(entry)}</Label>
          <Label muted>{new Date(entry.createdAt).toLocaleString()}</Label>
          <Label>本次奖励：{entry.expected}</Label>
          <Label>实际到账：{entry.amount}</Label>
          <Label>结算前余额：{entry.before}</Label>
          <Label>结算后余额：{entry.after}</Label>
          {entry.outcome === "capped" && (
            <Label muted>已按当日剩余额度结算</Label>
          )}
        </View>
      )}
    </Screen>
  );
}
