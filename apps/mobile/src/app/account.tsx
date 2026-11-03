import { router } from "expo-router";
import { View } from "react-native";
import { UserRound, KeyRound, Smartphone } from "lucide-react-native";
import { Screen } from "../components/Screen";
import { useSession } from "../components/use-runtime";
import { Label, MenuRow, styles } from "../components/ui";
export default function Account() {
  const { user } = useSession();
  return (
    <Screen title="账号与安全" back>
      <View style={styles.card}>
        <Label muted>用户名</Label>
        <Label>{user?.username}</Label>
      </View>
      <View style={styles.group}>
        <MenuRow
          icon={UserRound}
          title="修改昵称"
          detail={user?.displayName}
          onPress={() => router.push("/edit-nickname")}
        />
        <MenuRow
          icon={KeyRound}
          title="修改密码"
          onPress={() => router.push("/change-password")}
        />
        <MenuRow
          icon={Smartphone}
          title="登录设备"
          last
          onPress={() => router.push("/devices")}
        />
      </View>
    </Screen>
  );
}
