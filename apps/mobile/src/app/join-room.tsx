import { useState } from "react";
import { Keyboard } from "react-native";
import { router, useLocalSearchParams, useNavigation } from "expo-router";
import { runtime } from "../runtime";
import { action } from "../components/use-runtime";
import { Sheet } from "../components/Sheet";
import { Button, Field } from "../components/ui";

export default function JoinRoom() {
  const navigation = useNavigation();
  const params = useLocalSearchParams<{ code?: string }>();
  const [code, setCode] = useState(() =>
    typeof params.code === "string" ? params.code : "",
  );
  const [password, setPassword] = useState("");
  return (
    <Sheet title="加入房间">
      <Field
        label="房间号或邀请链接"
        testID="join-code"
        value={code}
        onChangeText={setCode}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Field
        label="房间密码（如需）"
        testID="join-password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="off"
      />
      <Button
        primary
        testID="join-submit"
        onPress={action(async () => {
          const joined = await runtime.join(code, password || undefined);
          if (joined && navigation.isFocused()) {
            Keyboard.dismiss();
            router.dismissTo("/room");
          }
        })}
      >
        加入房间
      </Button>
    </Sheet>
  );
}
