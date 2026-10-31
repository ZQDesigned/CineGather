import {
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { View, Text, ActivityIndicator, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Download, RefreshCw } from "lucide-react-native";
import { runtime } from "../runtime";
import { colors, styles, Button, Label, MenuRow } from "./ui";
import { mobileCodeVersion, mobileUpdateIdentity } from "../platform/updates";
const subscribe = (listener: () => void) =>
  runtime.updates.updater.subscribe(listener);
const snapshot = () => runtime.updates.updater.snapshot();
function useMobileUpdates() {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
export function UpdateGate({ children }: { children: ReactNode }) {
  const state = useMobileUpdates();
  if (!state.required) return <>{children}</>;
  // Replace the route tree so native bottom sheets cannot cover a required update.
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: "center",
          padding: 24,
        }}
      >
        <View style={[styles.card, { gap: 18 }]}>
          <Download size={32} color={colors.accent} />
          <Text style={styles.heading}>需要更新映聚</Text>
          <Label>
            {state.kind === "package"
              ? "当前安装版本已无法兼容，请安装新版后继续使用。"
              : "连接协议已更新，请完成热更新后继续使用。"}
          </Label>
          <UpdateActions required />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
export function UpdateSettings() {
  const state = useMobileUpdates();
  const [expanded, setExpanded] = useState(false);
  const detail =
    state.status === "unsupported"
      ? "开发模式通过本地服务同步"
      : state.status === "downloading"
        ? "正在下载更新"
        : state.status === "ready"
          ? "更新已就绪，下次启动生效"
          : state.kind === "package"
            ? "有新的安装版本"
            : `当前版本 ${mobileCodeVersion}`;
  return (
    <View style={styles.group}>
      <MenuRow
        icon={RefreshCw}
        title="应用更新"
        detail={detail}
        last={!expanded}
        onPress={() => {
          setExpanded(!expanded);
          void runtime.updates.check(true);
        }}
      />
      {expanded && (
        <View style={{ paddingVertical: 14, gap: 12 }}>
          <UpdateActions />
        </View>
      )}
    </View>
  );
}
function UpdateActions({ required = false }: { required?: boolean }) {
  const state = useMobileUpdates();
  useEffect(() => {
    if (!required && state.error) runtime.fail(new Error(state.error));
  }, [required, state.error]);
  const busy = ["checking", "downloading", "applying"].includes(state.status);
  const release =
    state.kind === "package" ? state.policy?.native : state.policy?.ota;
  const perform = (action: () => Promise<void>) => () => {
    void action().catch((error) => runtime.fail(error));
  };
  return (
    <>
      <Label muted>当前版本 {mobileCodeVersion}</Label>
      {!!release && (
        <>
          <Label>新版本 {release.version}</Label>
          {!!release.notes && (
            <Text
              numberOfLines={6}
              style={{ color: colors.muted, fontSize: 14, lineHeight: 22 }}
            >
              {release.notes}
            </Text>
          )}
        </>
      )}
      {busy && (
        <View style={[styles.row, { gap: 10 }]}>
          <ActivityIndicator color={colors.accent} />
          <Label>
            {state.status === "downloading"
              ? "正在下载并校验更新…"
              : state.status === "applying"
                ? "正在切换到新版…"
                : "正在检查更新…"}
          </Label>
        </View>
      )}
      {required && state.error && <Label>{state.error}</Label>}
      {state.status === "unsupported" ? (
        <Label muted>
          正式安装版本支持在线更新，开发版继续使用本地服务同步。
        </Label>
      ) : (
        <>
          {state.kind === "hot" && state.status === "ready" && (
            <Button
              primary
              onPress={perform(() => runtime.updates.updater.apply())}
            >
              {runtime.snapshot().room ? "退出房间并应用更新" : "立即应用更新"}
            </Button>
          )}
          {state.kind === "package" && (
            <Button
              primary
              onPress={perform(() => runtime.updates.openPackage())}
            >
              获取新版安装包
            </Button>
          )}
          <Button
            disabled={busy}
            onPress={perform(() => runtime.updates.check(true))}
          >
            {state.status === "error" ? "重试更新" : "检查更新"}
          </Button>
          {!required && state.status === "ready" && (
            <Label muted>也可继续使用，更新将在下次启动时生效。</Label>
          )}
          {!required && state.kind === "none" && state.status === "idle" && (
            <Label muted>当前已是最新版本</Label>
          )}
        </>
      )}
      {!required && <Label muted>安装构建 {mobileUpdateIdentity.build}</Label>}
    </>
  );
}
