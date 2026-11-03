import { useState } from "react";
import { useNavigation, router } from "expo-router";
import { View, Text } from "react-native";
import { profileInput } from "@cinegather/contracts";
import { runtime } from "../runtime";
import { Screen } from "../components/Screen";
import { useSession } from "../components/use-runtime";
import { Field, Button, styles, colors } from "../components/ui";
export default function EditNickname() {
  const { user } = useSession();
  const navigation = useNavigation();
  const [name, setName] = useState(user?.displayName ?? "");
  const [error, setError] = useState<string>();
  return (
    <Screen title="修改昵称" back>
      <View style={styles.card}>
        <Field
          label="昵称"
          autoFocus
          autoComplete="nickname"
          maxLength={32}
          value={name}
          onChangeText={(value) => {
            setName(value);
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
          disabled={name.trim() === user?.displayName}
          onPress={async () => {
            const parsed = profileInput.safeParse({ displayName: name });
            if (!parsed.success) {
              setError(parsed.error.issues[0]?.message ?? "请输入昵称");
              return;
            }
            if (await runtime.changeNickname(parsed.data.displayName)) {
              runtime.feedback.show({ text: "昵称已修改", tone: "success" });
              if (navigation.isFocused()) router.back();
            }
          }}
        >
          保存昵称
        </Button>
      </View>
    </Screen>
  );
}
