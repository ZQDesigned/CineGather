import { useState, useSyncExternalStore } from "react";
import { View } from "react-native";
import { featureLabels, versionBelow } from "@cinegather/contracts";
import { runtime } from "../runtime";
import { useRuntime } from "./use-runtime";
import { Dialog, Label, Button } from "./ui";
export function FeatureUpdatePrompt() {
  const { featureUpdate: issue } = useRuntime();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string>();
  const close = () => {
    runtime.dismissFeatureUpdate();
    setError(undefined);
  };
  const global = useSyncExternalStore(
    runtime.updates.updater.subscribe,
    runtime.updates.updater.snapshot,
  );
  if (!issue || global.required) return null;
  const update = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await runtime.updates.check(true);
      if (runtime.snapshot().featureUpdate !== issue) return;
      const state = runtime.updates.updater.snapshot();
      if (
        issue.updateKind === "hot" &&
        state.kind === "hot" &&
        state.status === "ready" &&
        state.policy?.ota &&
        state.policy.ota.revision >= (issue.minimumRevision ?? 0)
      ) {
        await runtime.updates.updater.apply();
        return;
      }
      const release = state.policy?.native;
      if (
        !release ||
        release.build < (issue.minimumBuild ?? 0) ||
        (issue.minimumVersion &&
          versionBelow(release.version, issue.minimumVersion))
      )
        throw Error("满足此功能要求的更新暂未提供，请稍后再试。");
      if (issue.updateKind === "hot" && state.kind !== "package")
        throw Error(state.error ?? "热更新尚未就绪，请稍后重试。");
      await runtime.updates.openPackage();
    } catch (e) {
      setError(e instanceof Error ? e.message : "暂时无法检查更新。");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog visible title="此功能需要更新后使用" close={close}>
      <View style={{ gap: 14 }}>
        <Label>{featureLabels[issue.feature]}</Label>
        <Label>{issue.reason}</Label>
        {issue.minimumVersion && (
          <Label muted>需要 {issue.minimumVersion} 或更高版本</Label>
        )}
        {error && <Label>{error}</Label>}
        <Button primary disabled={busy} onPress={() => void update()}>
          {busy
            ? "正在检查更新…"
            : issue.updateKind === "hot"
              ? "应用热更新"
              : "获取新版安装包"}
        </Button>
        <Button onPress={close}>暂不使用</Button>
      </View>
    </Dialog>
  );
}
