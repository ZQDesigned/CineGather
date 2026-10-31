import { NativeTabs } from "expo-router/unstable-native-tabs";
import { colors } from "./ui";
import { useRuntime } from "./use-runtime";

export function PlatformTabs() {
  const state = useRuntime();
  const pending = state.friends.items.filter(
    (f) => f.status === "pending" && f.incoming,
  ).length;
  return (
    <NativeTabs
      tintColor={colors.accent}
      iconColor={{ default: colors.muted, selected: colors.accent }}
      labelStyle={{
        default: { color: colors.muted },
        selected: { color: colors.accent },
      }}
      minimizeBehavior="never"
    >
      <NativeTabs.Trigger name="index" disableAutomaticContentInsets>
        <NativeTabs.Trigger.Label>放映厅</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: "film", selected: "film.fill" }}
        />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="friends" disableAutomaticContentInsets>
        <NativeTabs.Trigger.Label>好友</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: "person.2", selected: "person.2.fill" }}
        />
        <NativeTabs.Trigger.Badge hidden={!pending}>
          {pending ? String(Math.min(pending, 99)) : undefined}
        </NativeTabs.Trigger.Badge>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="notifications" disableAutomaticContentInsets>
        <NativeTabs.Trigger.Label>通知</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: "bell", selected: "bell.fill" }}
        />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="settings" disableAutomaticContentInsets>
        <NativeTabs.Trigger.Label>设置</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: "gearshape", selected: "gearshape.fill" }}
        />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
