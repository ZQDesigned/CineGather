import { Text, View } from "react-native";
import { useRuntime, action } from "../../components/use-runtime";
import { runtime } from "../../runtime";
import { Page, styles, Button, Label } from "../../components/ui";
export default function Notices() {
  const state = useRuntime();
  return <Page><View style={styles.spread}><Text style={styles.title}>通知</Text><Button onPress={action(() => runtime.refreshAnnouncements())}>刷新</Button></View>
    {state.announcements.map(item => <View style={styles.card} key={item.id}><Text style={styles.heading}>{item.title}</Text><Label>{item.body}</Label><Label muted>{item.kind === "maintenance" ? "维护公告" : "全站公告"}{item.expiresAt ? ` 至 ${new Date(item.expiresAt).toLocaleString()}` : ""}</Label>{!item.read && <Button onPress={action(() => runtime.readAnnouncement(item.id))}>标为已读</Button>}</View>)}
    {state.notices.map(item => <View style={styles.card} key={item.id}><Text style={styles.heading}>{item.title}</Text><Label>{item.body}</Label><Label muted>{new Date(item.time).toLocaleString()}</Label></View>)}
    {!state.notices.length && !state.announcements.length && <Label muted>暂时没有新通知。</Label>}
  </Page>;
}
