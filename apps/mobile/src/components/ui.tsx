import { useState, type ReactNode } from "react";
import {
  View,
  Text,
  Pressable,
  TextInput,
  Modal,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  ActivityIndicator,
  type TextInputProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ChevronRight, X, type LucideIcon } from "lucide-react-native";
import { colors } from "./theme";
import { SnackbarHost } from "./Snackbar";
import { runtime } from "../runtime";
export { colors } from "./theme";
export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 16, paddingBottom: 24 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  spread: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    padding: 16,
    gap: 12,
  },
  group: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    overflow: "hidden",
  },
  title: {
    color: colors.text,
    fontSize: 24,
    lineHeight: 32,
    fontWeight: "700",
  },
  heading: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "600",
  },
  text: { color: colors.text, fontSize: 14, lineHeight: 22 },
  muted: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  field: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 13,
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 11,
    color: colors.text,
    fontSize: 16,
    backgroundColor: colors.bg,
  },
  button: {
    height: 46,
    borderRadius: 13,
    paddingHorizontal: 16,
    justifyContent: "center",
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.border,
  },
  buttonText: { color: colors.text, fontSize: 14, fontWeight: "600" },
  avatar: {
    backgroundColor: "#302a43",
    justifyContent: "center",
    alignItems: "center",
  },
});
export function Label({
  children,
  muted = false,
}: {
  children: ReactNode;
  muted?: boolean;
}) {
  return <Text style={muted ? styles.muted : styles.text}>{children}</Text>;
}
export function Button({
  children,
  onPress,
  primary,
  danger,
  disabled,
  testID,
  icon: Icon,
  style,
  quiet,
}: {
  children: ReactNode;
  onPress(): void | Promise<unknown>;
  primary?: boolean;
  danger?: boolean;
  disabled?: boolean;
  testID?: string;
  icon?: LucideIcon;
  style?: StyleProp<ViewStyle>;
  quiet?: boolean;
}) {
  const [working, setWorking] = useState(false);
  const color = primary ? colors.bg : danger ? colors.danger : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || working }}
      testID={testID}
      disabled={disabled || working}
      onPress={() => {
        setWorking(true);
        Promise.resolve()
          .then(onPress)
          .catch((error) => runtime.fail(error))
          .finally(() => setWorking(false));
      }}
      style={({ pressed }) => [
        styles.button,
        primary && {
          backgroundColor: colors.accent,
          borderColor: colors.accent,
        },
        quiet && { backgroundColor: "transparent", borderColor: "transparent" },
        { opacity: disabled || working ? 0.4 : pressed ? 0.7 : 1 },
        style,
      ]}
    >
      {working ? (
        <ActivityIndicator size="small" color={color} />
      ) : (
        Icon && <Icon size={18} color={color} />
      )}
      <Text numberOfLines={1} style={[styles.buttonText, { color }]}>
        {children}
      </Text>
    </Pressable>
  );
}
export function IconButton({
  icon: Icon,
  label,
  onPress,
  active,
  disabled,
  danger,
  testID,
}: {
  icon: LucideIcon;
  label: string;
  onPress(): void | Promise<unknown>;
  active?: boolean;
  disabled?: boolean;
  danger?: boolean;
  testID?: string;
}) {
  const [working, setWorking] = useState(false);
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || working, selected: active }}
      disabled={disabled || working}
      onPress={() => {
        setWorking(true);
        Promise.resolve()
          .then(onPress)
          .catch((error) => runtime.fail(error))
          .finally(() => setWorking(false));
      }}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        borderRadius: 13,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: active
          ? "#302943"
          : pressed
            ? colors.raised
            : "transparent",
        opacity: disabled || working ? 0.4 : 1,
      })}
    >
      {working ? (
        <ActivityIndicator size="small" color={colors.accent} />
      ) : (
        <Icon
          size={21}
          color={danger ? colors.danger : active ? colors.accent : colors.muted}
        />
      )}
    </Pressable>
  );
}
export function Field({
  label,
  ...props
}: TextInputProps & { label?: string }) {
  return (
    <View style={{ gap: 8 }}>
      {label && <Text style={styles.text}>{label}</Text>}
      <TextInput
        autoCapitalize={props.secureTextEntry ? "none" : undefined}
        autoCorrect={props.secureTextEntry ? false : undefined}
        {...props}
        accessibilityLabel={props.accessibilityLabel ?? label}
        placeholderTextColor={colors.muted}
        style={[
          styles.field,
          Platform.OS === "android" && {
            // Give native font metrics the full single-line content area.
            paddingVertical: props.multiline ? 11 : 0,
            includeFontPadding: true,
            textAlignVertical: props.multiline ? "top" : "center",
          },
          props.style,
        ]}
      />
    </View>
  );
}
export function Avatar({ name, size = 42 }: { name: string; size?: number }) {
  return (
    <View
      style={[
        styles.avatar,
        { width: size, height: size, borderRadius: size / 2 },
      ]}
    >
      <Text
        style={{
          color: colors.accent,
          fontSize: size * 0.4,
          fontWeight: "600",
        }}
      >
        {name.slice(0, 1)}
      </Text>
    </View>
  );
}
export function Badge({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "muted" | "accent" | "success" | "danger";
}) {
  const color =
    tone === "accent"
      ? colors.accent
      : tone === "success"
        ? colors.green
        : tone === "danger"
          ? colors.danger
          : colors.muted;
  return (
    <View
      style={{
        backgroundColor:
          tone === "accent"
            ? "#302943"
            : tone === "success"
              ? "#20362f"
              : colors.raised,
        borderRadius: 6,
        paddingHorizontal: 7,
        paddingVertical: 2,
        alignSelf: "flex-start",
      }}
    >
      <Text
        numberOfLines={1}
        style={{ color, fontSize: 10, lineHeight: 16, fontWeight: "500" }}
      >
        {children}
      </Text>
    </View>
  );
}
export function SectionHeading({
  title,
  count,
  action,
}: {
  title: string;
  count?: number;
  action?: ReactNode;
}) {
  return (
    <View style={[styles.spread, { minHeight: 32, marginTop: 4 }]}>
      <View style={styles.row}>
        <Text style={styles.heading}>{title}</Text>
        {count !== undefined && <Badge>{count}</Badge>}
      </View>
      {action}
    </View>
  );
}
export function EmptyState({
  icon: Icon,
  title,
  detail,
}: {
  icon: LucideIcon;
  title: string;
  detail?: string;
}) {
  return (
    <View
      style={{
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        paddingVertical: 36,
        paddingHorizontal: 20,
      }}
    >
      <View
        style={{
          width: 56,
          height: 56,
          borderRadius: 18,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: colors.surface,
          marginBottom: 3,
        }}
      >
        <Icon size={25} color={colors.muted} />
      </View>
      <Text style={[styles.text, { color: colors.muted }]}>{title}</Text>
      {detail && (
        <Text style={[styles.muted, { textAlign: "center" }]}>{detail}</Text>
      )}
    </View>
  );
}
export function MenuRow({
  icon: Icon,
  title,
  detail,
  value,
  onPress,
  danger,
  last = false,
}: {
  icon: LucideIcon;
  title: string;
  detail?: string;
  value?: ReactNode;
  onPress?(): void | Promise<unknown>;
  danger?: boolean;
  last?: boolean;
}) {
  const [working, setWorking] = useState(false);
  return (
    <Pressable
      accessibilityRole={onPress ? "button" : "text"}
      disabled={!onPress || working}
      onPress={() => {
        setWorking(true);
        Promise.resolve()
          .then(onPress)
          .catch((error) => runtime.fail(error))
          .finally(() => setWorking(false));
      }}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        minHeight: 58,
        paddingHorizontal: 14,
        paddingVertical: 12,
        borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
        borderBottomColor: colors.border,
        backgroundColor: pressed ? colors.raised : "transparent",
      })}
    >
      <Icon size={20} color={danger ? colors.danger : colors.muted} />
      <View style={{ flex: 1, gap: 3 }}>
        <Text
          style={[styles.text, { color: danger ? colors.danger : colors.text }]}
        >
          {title}
        </Text>
        {detail && <Text style={styles.muted}>{detail}</Text>}
      </View>
      {working ? (
        <ActivityIndicator size="small" color={colors.accent} />
      ) : value ? (
        <View style={{ justifyContent: "center" }}>{value}</View>
      ) : null}
      {onPress && <ChevronRight size={16} color={colors.muted} />}
    </Pressable>
  );
}
export function Page({
  children,
  scroll = true,
  safeBottom = false,
  safeTop = false,
  header,
  contentStyle,
}: {
  children: ReactNode;
  scroll?: boolean;
  safeBottom?: boolean;
  safeTop?: boolean;
  header?: ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
}) {
  return (
    <SafeAreaView
      edges={[
        ...(safeTop ? ["top" as const] : []),
        "left",
        "right",
        ...(safeBottom ? ["bottom" as const] : []),
      ]}
      style={styles.screen}
    >
      {header}
      {scroll ? (
        <ScrollView
          testID="screen-content"
          automaticallyAdjustContentInsets={false}
          contentInsetAdjustmentBehavior="never"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[styles.content, contentStyle]}
        >
          {children}
        </ScrollView>
      ) : (
        children
      )}
    </SafeAreaView>
  );
}
export function Dialog({
  title,
  visible,
  close,
  children,
}: {
  title: string;
  visible: boolean;
  close(): void;
  children: ReactNode;
}) {
  return (
    <Modal
      transparent
      animationType="fade"
      visible={visible}
      onRequestClose={close}
    >
      <SafeAreaView style={{ flex: 1, backgroundColor: "#000a", padding: 16 }}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={{ flex: 1, justifyContent: "center" }}
        >
          <View
            style={[
              styles.card,
              { maxHeight: "92%", padding: 18, gap: 0, borderRadius: 22 },
            ]}
          >
            <View
              style={[
                styles.spread,
                {
                  paddingBottom: 12,
                  borderBottomWidth: StyleSheet.hairlineWidth,
                  borderBottomColor: colors.border,
                },
              ]}
            >
              <Text style={[styles.heading, { flex: 1 }]}>{title}</Text>
              <IconButton icon={X} label="关闭" onPress={close} />
            </View>
            <ScrollView
              style={{ flexGrow: 0 }}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingTop: 16, gap: 16 }}
            >
              {children}
            </ScrollView>
          </View>
          <SnackbarHost priority={20} enabled={visible} />
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}
