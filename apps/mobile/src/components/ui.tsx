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
  type TextInputProps,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
export const colors = {
  bg: "#0e1118",
  surface: "#191c27",
  raised: "#242738",
  border: "#31364b",
  text: "#f1eff9",
  muted: "#9299ae",
  accent: "#b4a0f4",
  danger: "#ff808e",
  green: "#80d1ab",
};
export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, gap: 18, paddingBottom: 32 },
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
    padding: 18,
    gap: 14,
  },
  title: { color: colors.text, fontSize: 25, fontWeight: "700" },
  heading: { color: colors.text, fontSize: 17, fontWeight: "600" },
  text: { color: colors.text, fontSize: 15, lineHeight: 23 },
  muted: { color: colors.muted, fontSize: 13, lineHeight: 21 },
  field: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 11,
    color: colors.text,
    fontSize: 16,
    backgroundColor: colors.bg,
  },
  button: {
    height: 44,
    borderRadius: 12,
    paddingHorizontal: 16,
    justifyContent: "center",
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    backgroundColor: colors.raised,
  },
  buttonText: { color: colors.text, fontSize: 15, fontWeight: "600" },
  avatar: {
    width: 44,
    height: 44,
    backgroundColor: "#302a43",
    borderRadius: 22,
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
}: {
  children: ReactNode;
  onPress(): void | Promise<unknown>;
  primary?: boolean;
  danger?: boolean;
  disabled?: boolean;
  testID?: string;
}) {
  const [working, setWorking] = useState(false);
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
          .catch(() => {})
          .finally(() => setWorking(false));
      }}
      style={({ pressed }) => [
        styles.button,
        primary && { backgroundColor: colors.accent },
        { opacity: disabled || working ? 0.4 : pressed ? 0.7 : 1 },
      ]}
    >
      <Text
        style={[
          styles.buttonText,
          primary && { color: colors.bg },
          danger && { color: colors.danger },
        ]}
      >
        {working ? "请稍候…" : children}
      </Text>
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
        style={[styles.field, props.style]}
      />
    </View>
  );
}
export function Avatar({ name }: { name: string }) {
  return (
    <View style={styles.avatar}>
      <Text style={{ color: colors.accent, fontSize: 18 }}>
        {name.slice(0, 1)}
      </Text>
    </View>
  );
}
export function Page({
  children,
  scroll = true,
  safeBottom = false,
}: {
  children: ReactNode;
  scroll?: boolean;
  safeBottom?: boolean;
}) {
  return (
    <SafeAreaView
      edges={safeBottom ? ["left", "right", "bottom"] : ["left", "right"]}
      style={styles.screen}
    >
      {scroll ? (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.content}
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
      <SafeAreaView
        style={{
          flex: 1,
          backgroundColor: "#000a",
          justifyContent: "center",
          padding: 20,
        }}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={[styles.card, { padding: 22 }]}
          >
            <View style={styles.spread}>
              <Text style={styles.heading}>{title}</Text>
              <Button onPress={close}>关闭</Button>
            </View>
            {children}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}
