import { Bell, RefreshCw } from "lucide-react-native";
import { Screen } from "../../components/Screen";
import { Text, View } from "react-native";
import { useRuntime, action } from "../../components/use-runtime";
import { runtime } from "../../runtime";
import {
  styles,
  Button,
  Label,
  IconButton,
  Badge,
  EmptyState,
} from "../../components/ui";
export default function Notices() {
  const state = useRuntime();
  return (
    <Screen
      title="通知"
      actions={
        <IconButton
          icon={RefreshCw}
          label="刷新通知"
          onPress={action(() => runtime.refreshAnnouncements())}
        />
      }
    >
      {state.announcements.map((item) => (
        <View style={styles.card} key={item.id}>
          <View style={styles.spread}>
            <Text style={[styles.heading, { flex: 1 }]}>{item.title}</Text>
            {!item.read && <Badge tone="accent">未读</Badge>}
          </View>
          <Label>{item.body}</Label>
          <Label muted>
            {item.kind === "maintenance" ? "维护公告" : "全站公告"}
            {item.expiresAt
              ? ` 至 ${new Date(item.expiresAt).toLocaleString()}`
              : ""}
          </Label>
          {!item.read && (
            <Button
              quiet
              onPress={action(() => runtime.readAnnouncement(item.id))}
            >
              标为已读
            </Button>
          )}
        </View>
      ))}
      {state.notices.map((item) => (
        <View style={styles.card} key={item.id}>
          <Text style={styles.heading}>{item.title}</Text>
          <Label>{item.body}</Label>
          <Label muted>{new Date(item.time).toLocaleString()}</Label>
        </View>
      ))}
      {!state.notices.length && !state.announcements.length && (
        <EmptyState icon={Bell} title="暂无通知" />
      )}
    </Screen>
  );
}
