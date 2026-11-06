import { useEffect, useRef, useState } from "react";
import { View, Alert } from "react-native";
import { router } from "expo-router";
import type {
  WhiteboardDocument,
  WhiteboardRecord,
} from "@cinegather/contracts";
import { runtime } from "../runtime";
import { startActivity } from "../activities";
import { Screen } from "../components/Screen";
import { Button, Label, styles } from "../components/ui";
import { MobileWhiteboard, useActivities } from "../components/Activities";
import { useSession } from "../components/use-runtime";
export default function Whiteboards() {
  const [items, setItems] = useState<WhiteboardRecord[]>([]),
    [record, setRecord] = useState<{ id: string; board: WhiteboardDocument }>();
  const current = useRef<string | undefined>(undefined),
    { snapshot, status } = useActivities(),
    userId = useSession().user?.id;
  async function refresh() {
    const result = (await runtime.api.call("whiteboards", (c) =>
      c.GET("/api/v1/whiteboards"),
    )) as { items: WhiteboardRecord[] };
    setItems(result.items);
  }
  useEffect(() => {
    void refresh().catch((e) => runtime.fail(e));
    return () => {
      current.current = undefined;
    };
  }, []);
  return (
    <Screen title="白板记录">
      {record ? (
        <>
          <Button
            onPress={() => {
              current.current = undefined;
              setRecord(undefined);
            }}
          >
            返回记录
          </Button>
          <MobileWhiteboard elements={record.board.elements} />
          {snapshot && status === "connected" && (
            <Button
              primary
              onPress={() =>
                Alert.alert(
                  "创建新白板？",
                  "当前活动将结束，这份记录的原件不会改变",
                  [
                    { text: "取消", style: "cancel" },
                    {
                      text: "创建",
                      onPress: () => {
                        if (
                          snapshot.kind !== "idle" &&
                          ![snapshot.ownerId, snapshot.starterId].includes(
                            userId,
                          )
                        )
                          return runtime.fail(Error("请先申请切换到白板"));
                        void startActivity(
                          "board",
                          undefined,
                          record.id,
                          snapshot,
                        )
                          .then(() => router.replace("/room-activity"))
                          .catch((e) => runtime.fail(e));
                      },
                    },
                  ],
                )
              }
            >
              以此创建新白板
            </Button>
          )}
        </>
      ) : items.length ? (
        items.map((item) => (
          <View key={item.id} style={[styles.card, { gap: 8 }]}>
            <Label>{item.title}</Label>
            <Label muted>{new Date(item.createdAt).toLocaleString()}</Label>
            <View style={styles.row}>
              <Button
                onPress={async () => {
                  current.current = item.id;
                  const board = (await runtime.api.call("whiteboard", (c) =>
                    c.GET("/api/v1/whiteboards/{whiteboardId}", {
                      params: { path: { whiteboardId: item.id } },
                    }),
                  )) as WhiteboardDocument;
                  if (current.current === item.id)
                    setRecord({ id: item.id, board });
                }}
              >
                查看
              </Button>
              <Button
                danger
                onPress={() =>
                  Alert.alert("删除你的这份记录？", "其他成员的记录不受影响", [
                    { text: "取消", style: "cancel" },
                    {
                      text: "删除",
                      style: "destructive",
                      onPress: () =>
                        void runtime.api
                          .call("whiteboard-delete", (c) =>
                            c.DELETE("/api/v1/whiteboards/{whiteboardId}", {
                              params: { path: { whiteboardId: item.id } },
                            }),
                          )
                          .then(refresh)
                          .catch((e) => runtime.fail(e)),
                    },
                  ])
                }
              >
                删除
              </Button>
            </View>
          </View>
        ))
      ) : (
        <Label muted>还没有白板记录</Label>
      )}
    </Screen>
  );
}
