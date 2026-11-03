import { useState } from "react";
import { Keyboard } from "react-native";
import { router, useNavigation } from "expo-router";
import { runtime } from "../runtime";
import { action, useSession } from "../components/use-runtime";
import { Sheet } from "../components/Sheet";
import { Button, Field } from "../components/ui";

export default function CreateRoom() {
  const navigation = useNavigation();
  const limit = useSession().user?.standardRoomMaxMembers ?? 10;
  const [name, setName] = useState("今晚一起看");
  const [max, setMax] = useState("5");
  const [password, setPassword] = useState("");
  return (
    <Sheet title="创建房间">
      <Field
        label="房间名称"
        testID="create-name"
        value={name}
        onChangeText={setName}
        maxLength={64}
      />
      <Field
        label={`人数上限（2–${limit}）`}
        testID="create-max"
        value={max}
        onChangeText={setMax}
        keyboardType="number-pad"
      />
      <Field
        label="房间密码（留空为普通房）"
        testID="create-password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="off"
      />
      <Button
        primary
        testID="create-submit"
        onPress={action(async () => {
          if (
            !Number.isInteger(Number(max)) ||
            Number(max) < 2 ||
            Number(max) > limit
          )
            throw new Error(`人数上限应为 2–${limit} 的整数`);
          await runtime.create(name, Number(max), password || undefined);
          if (
            navigation.isFocused() &&
            runtime.snapshot().roomState === "connected"
          ) {
            Keyboard.dismiss();
            router.dismissTo("/room");
          }
        })}
      >
        创建并加入
      </Button>
    </Sheet>
  );
}
