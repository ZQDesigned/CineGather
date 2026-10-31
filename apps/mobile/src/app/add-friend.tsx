import { useRef, useState } from "react";
import { Keyboard, View, Text } from "react-native";
import { useNavigation } from "expo-router";
import { Send } from "lucide-react-native";
import { friendSearchSchema } from "@cinegather/contracts";
import { runtime } from "../runtime";
import { action } from "../components/use-runtime";
import { Sheet, closeSheet } from "../components/Sheet";
import { Avatar, Button, Field, Label, styles } from "../components/ui";

export default function AddFriend() {
  const navigation = useNavigation();
  const [username, setUsername] = useState("");
  const [result, setResult] =
    useState<ReturnType<typeof friendSearchSchema.parse>["user"]>();
  const revision = useRef(0);
  return (
    <Sheet title="添加好友">
      <Field
        label="用户名"
        testID="friend-username"
        autoCapitalize="none"
        autoCorrect={false}
        value={username}
        onChangeText={(value) => {
          revision.current++;
          setUsername(value);
          setResult(undefined);
        }}
      />
      <Button
        testID="friend-search"
        onPress={action(async () => {
          const request = ++revision.current;
          const found = friendSearchSchema.parse(
            await runtime.api.call("search-friend", (c) =>
              c.GET("/api/v1/friends/search", {
                params: { query: { username } },
              }),
            ),
          ).user;
          if (navigation.isFocused() && request === revision.current)
            setResult(found);
        })}
      >
        搜索
      </Button>
      {result === null && <Label>没有找到该用户</Label>}
      {result && (
        <>
          <View style={styles.row}>
            <Avatar name={result.displayName} />
            <View style={{ flex: 1 }}>
              <Text style={styles.heading}>{result.displayName}</Text>
              <Label muted>{result.username}</Label>
            </View>
          </View>
          <Button
            primary
            icon={Send}
            testID="friend-add"
            onPress={action(async () => {
              await runtime.api.call("add-friend", (c) =>
                c.POST("/api/v1/friends", { body: { userId: result.userId } }),
              );
              if (navigation.isFocused()) {
                Keyboard.dismiss();
                closeSheet();
              }
              await runtime.refresh();
            })}
          >
            发送好友申请
          </Button>
        </>
      )}
    </Sheet>
  );
}
