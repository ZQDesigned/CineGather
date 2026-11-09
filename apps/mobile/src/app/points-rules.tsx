import { useEffect, useState } from "react";
import { View } from "react-native";
import {
  publicPointsPolicySchema,
  type PublicPointsPolicy,
} from "@cinegather/contracts";
import { pointsGameName } from "@cinegather/client-core";
import { runtime } from "../runtime";
import { Screen } from "../components/Screen";
import { Button, Label, styles } from "../components/ui";
export default function PointsRules() {
  const [policy, setPolicy] = useState<PublicPointsPolicy>(),
    [error, setError] = useState<string>(),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setError(undefined);
    void runtime.api
      .call("points-rules", (c) => c.GET("/api/v1/points/rules"))
      .then((r) => {
        if (active) setPolicy(publicPointsPolicySchema.parse(r));
      })
      .catch((e) => {
        if (active)
          setError(e instanceof Error ? e.message : "无法读取积分规则");
      });
    return () => {
      active = false;
    };
  }, [revision]);
  return (
    <Screen title="积分规则" back>
      {error && (
        <View style={styles.card}>
          <Label>{error}</Label>
          <Button onPress={() => setRevision((n) => n + 1)}>重试</Button>
        </View>
      )}
      {policy && (
        <>
          <Label>每日总上限 {policy.dailyCap} 积分</Label>
          {Object.entries(policy.games).map(([game, rules]) => (
            <View key={game} style={styles.card}>
              <Label>{pointsGameName(game)}</Label>
              <Label>本轮第 1 次提交猜中 +{rules.firstCorrect}</Label>
              <Label>本轮第 2 次提交猜中 +{rules.firstCorrect / 2}</Label>
              <Label muted>第 3 次及以后不发放积分</Label>
              {game === "party.draw" && (
                <Label>画手有实际绘画并正常完成本轮 +{rules.painter}</Label>
              )}
            </View>
          ))}
          <Label muted>
            同一题跨轮次可重复获分，两种玩法共用每日额度。按北京时间 00:00
            刷新，积分余额保留。达到上限不影响继续游戏和投稿资格统计。
          </Label>
        </>
      )}
    </Screen>
  );
}
