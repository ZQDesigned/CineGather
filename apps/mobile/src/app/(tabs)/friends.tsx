import { useState } from "react";
import { View, Text, Switch } from "react-native";
import { router } from "expo-router";
import { friendSearchSchema } from "@cinegather/contracts";
import { runtime } from "../../runtime";
import { useRuntime, action } from "../../components/use-runtime";
import {
  Page,
  styles,
  Button,
  Field,
  Dialog,
  Avatar,
  Label,
} from "../../components/ui";
export default function Friends() {
  const state = useRuntime();
  const [adding, setAdding] = useState(false),
    [username, setUsername] = useState("");
  const [result, setResult] =
    useState<ReturnType<typeof friendSearchSchema.parse>["user"]>();
  const [selected, setSelected] = useState<string>(),
    [remark, setRemark] = useState("");
  const run = (work: () => Promise<unknown>) =>
    action(async () => {
      await work();
      await runtime.refresh();
    });
  return (
    <Page>
      <View style={styles.spread}>
        <Text style={styles.title}>朋友们</Text>
        <Button
          primary
          onPress={() => {
            setResult(undefined);
            setUsername("");
            setAdding(true);
          }}
        >
          添加好友
        </Button>
      </View>
      <View style={styles.spread}>
        <Label>隐身</Label>
        <Switch
          accessibilityLabel="隐身"
          value={state.visibility === "invisible"}
          onValueChange={(value) => {
            void runtime.api
              .call("visibility", (c) =>
                c.POST("/api/v1/presence", {
                  body: { visibility: value ? "invisible" : "online" },
                }),
              )
              .then(() => runtime.setVisibility(value ? "invisible" : "online"))
              .catch((e) => runtime.fail(e));
          }}
        />
      </View>
      {state.friends.roomJoinRequests
        .filter((r) => r.incoming && r.status === "pending")
        .map((r) => (
          <View style={styles.card} key={r.id}>
            <Label>{r.displayName} 申请加入房间</Label>
            <View style={styles.row}>
              <Button
                primary
                onPress={run(() =>
                  runtime.api.call("approve-join", (c) =>
                    c.POST("/api/v1/room-requests/{requestId}/approve", {
                      params: { path: { requestId: r.id } },
                    }),
                  ),
                )}
              >
                同意
              </Button>
              <Button
                onPress={run(() =>
                  runtime.api.call("reject-join", (c) =>
                    c.POST("/api/v1/room-requests/{requestId}/reject", {
                      params: { path: { requestId: r.id } },
                    }),
                  ),
                )}
              >
                拒绝
              </Button>
            </View>
          </View>
        ))}
      {state.friends.roomInvitations.map((invite) => (
        <View style={styles.card} key={invite.id}>
          <Label>
            {invite.senderName} 邀请你加入 {invite.roomName}
          </Label>
          <View style={styles.row}>
            <Button
              primary
              onPress={action(async () => {
                await runtime.join(invite.roomId, undefined, invite.token);
                if (runtime.snapshot().room) {
                  await runtime.dismissInvite(invite.id);
                  router.push("/room");
                }
              })}
            >
              加入
            </Button>
            <Button onPress={run(() => runtime.dismissInvite(invite.id))}>
              忽略
            </Button>
          </View>
        </View>
      ))}
      {[...state.friends.items]
        .sort(
          (a, b) =>
            Number(b.pinned) - Number(a.pinned) ||
            Number(b.online) - Number(a.online),
        )
        .map((friend) => (
          <View style={styles.card} key={friend.userId}>
            <View style={styles.row}>
              <Avatar name={friend.remark || friend.displayName} />
              <View style={{ flex: 1 }}>
                <Text style={styles.heading}>
                  {friend.pinned ? "★ " : ""}
                  {friend.remark || friend.displayName}
                </Text>
                <Label muted>
                  {friend.status === "pending"
                    ? friend.incoming
                      ? "希望添加你为好友"
                      : "等待对方同意"
                    : friend.online
                      ? friend.room
                        ? `房间中（${friend.room.memberCount}/${friend.room.maxMembers}）`
                        : "在线"
                      : "离线"}
                </Label>
              </View>
              <Button
                onPress={() => {
                  setSelected(friend.userId);
                  setRemark(friend.remark || "");
                }}
              >
                更多
              </Button>
            </View>
            {friend.status === "pending" && friend.incoming ? (
              <Button
                primary
                onPress={run(() =>
                  runtime.api.call("accept-friend", (c) =>
                    c.POST("/api/v1/friends/{userId}/accept", {
                      params: { path: { userId: friend.userId } },
                    }),
                  ),
                )}
              >
                接受申请
              </Button>
            ) : (
              friend.status === "accepted" && (
                <View style={[styles.row, { flexWrap: "wrap" }]}>
                  {friend.online && friend.room && (
                    <Button
                      disabled={
                        friend.room.memberCount >= friend.room.maxMembers
                      }
                      onPress={run(async () => {
                        await runtime.api.call("request-join", (c) =>
                          c.POST("/api/v1/friends/{userId}/room-requests", {
                            params: { path: { userId: friend.userId } },
                          }),
                        );
                        runtime.notice(
                          "申请已发送",
                          "好友同意后将自动加入房间",
                        );
                      })}
                    >
                      {friend.room.memberCount >= friend.room.maxMembers
                        ? "房间已满"
                        : "申请加入"}
                    </Button>
                  )}
                  {state.room && (
                    <Button
                      onPress={run(() =>
                        runtime.api.call("invite-friend", (c) =>
                          c.POST("/api/v1/rooms/{roomId}/friend-invitations", {
                            params: { path: { roomId: state.room!.id } },
                            body: { userId: friend.userId },
                          }),
                        ),
                      )}
                    >
                      邀请到房间
                    </Button>
                  )}
                </View>
              )
            )}
          </View>
        ))}
      {!state.friends.items.length && (
        <Label muted>添加好友后，可以查看在线状态和邀请一起加入房间。</Label>
      )}
      <Dialog visible={adding} title="添加好友" close={() => setAdding(false)}>
        <Field
          label="用户名"
          autoCapitalize="none"
          value={username}
          onChangeText={setUsername}
        />
        <Button
          onPress={action(async () => {
            setResult(
              friendSearchSchema.parse(
                await runtime.api.call("search-friend", (c) =>
                  c.GET("/api/v1/friends/search", {
                    params: { query: { username } },
                  }),
                ),
              ).user,
            );
          })}
        >
          搜索
        </Button>
        {result === null && <Label>没有找到该用户</Label>}
        {result && (
          <>
            <Label>
              {result.displayName}（{result.username}）
            </Label>
            <Button
              primary
              onPress={run(async () => {
                await runtime.api.call("add-friend", (c) =>
                  c.POST("/api/v1/friends", {
                    body: { userId: result.userId },
                  }),
                );
                setAdding(false);
              })}
            >
              发送好友申请
            </Button>
          </>
        )}
      </Dialog>
      <Dialog
        visible={!!selected}
        title="好友设置"
        close={() => setSelected(undefined)}
      >
        <Field
          label="备注"
          value={remark}
          onChangeText={setRemark}
          maxLength={50}
        />
        <Button
          primary
          onPress={run(async () => {
            await runtime.api.call("remark", (c) =>
              c.PATCH("/api/v1/friends/{userId}/preferences", {
                params: { path: { userId: selected! } },
                body: { remark },
              }),
            );
            setSelected(undefined);
          })}
        >
          保存备注
        </Button>
        <Button
          onPress={run(async () => {
            const f = state.friends.items.find((f) => f.userId === selected);
            await runtime.api.call("pin", (c) =>
              c.PATCH("/api/v1/friends/{userId}/preferences", {
                params: { path: { userId: selected! } },
                body: { pinned: !f?.pinned },
              }),
            );
            setSelected(undefined);
          })}
        >
          切换置顶
        </Button>
        <Button
          danger
          onPress={run(async () => {
            await runtime.api.call("remove-friend", (c) =>
              c.DELETE("/api/v1/friends/{userId}", {
                params: { path: { userId: selected! } },
              }),
            );
            setSelected(undefined);
          })}
        >
          删除好友或拒绝申请
        </Button>
      </Dialog>
    </Page>
  );
}
