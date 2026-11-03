import { useState } from "react";
import { useNavigation, router } from "expo-router";
import { View, Text } from "react-native";
import { passwordInput } from "@cinegather/contracts";
import { runtime } from "../runtime";
import { Screen } from "../components/Screen";
import { Field, Button, styles, colors } from "../components/ui";
export default function ChangePassword() {
  const navigation = useNavigation();
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string>();
  return (
    <Screen title="修改密码" back>
      <View style={styles.card}>
        <Field
          label="当前密码"
          secureTextEntry
          autoComplete="current-password"
          maxLength={128}
          value={currentPassword}
          onChangeText={(v) => {
            setCurrentPassword(v);
            setError(undefined);
          }}
        />
        <Field
          label="新密码"
          secureTextEntry
          autoComplete="new-password"
          maxLength={128}
          value={password}
          onChangeText={(v) => {
            setPassword(v);
            setError(undefined);
          }}
        />
        <Field
          label="确认密码"
          secureTextEntry
          autoComplete="new-password"
          maxLength={128}
          value={confirmation}
          onChangeText={(v) => {
            setConfirmation(v);
            setError(undefined);
          }}
        />
        {error && (
          <Text
            accessibilityRole="alert"
            style={[styles.text, { color: colors.danger }]}
          >
            {error}
          </Text>
        )}
        <Button
          primary
          onPress={async () => {
            const parsed = passwordInput.safeParse({
              currentPassword,
              password,
            });
            if (!parsed.success) {
              setError(parsed.error.issues[0]?.message ?? "请检查密码");
              return;
            }
            if (password !== confirmation) {
              setError("两次输入的密码不一致");
              return;
            }
            if (await runtime.changePassword(currentPassword, password)) {
              setCurrentPassword("");
              setPassword("");
              setConfirmation("");
              runtime.feedback.show({
                text: "密码已修改，其他设备已退出登录",
                tone: "success",
              });
              if (navigation.isFocused()) router.back();
            }
          }}
        >
          保存密码
        </Button>
      </View>
    </Screen>
  );
}
