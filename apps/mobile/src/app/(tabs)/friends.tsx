import { useState } from "react";
import { View, Text, Switch } from "react-native";
import { router } from "expo-router";
import {
  UserPlus,
  Users,
  MoreHorizontal,
  Pin,
  LogIn,
  Mail,
  Check,
} from "lucide-react-native";
import { runtime } from "../../runtime";
import { useRuntime, action } from "../../components/use-runtime";
import { Screen } from "../../components/Screen";
import {
  styles,
  colors,
  Button,
  Field,
  Dialog,
  Avatar,
  Label,
  IconButton,
  SectionHeading,
  EmptyState,
  Badge,
} from "../../components/ui";
export default function Friends() {
  const state = useRuntime();
  const [selected, setSelected] = useState<string>(),
    [remark, setRemark] = useState("");
  const run = (work: () => Promise<unknown>) =>
    action(async () => {
      await work();
      await runtime.refresh();
    });
  const incoming = state.friends.items.filter((f) => f.status === "pending");
  const friends = state.friends.items
    .filter((f) => f.status === "accepted")
    .sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) ||
        Number(b.online) - Number(a.online),
    );
  const joinRequests = state.friends.roomJoinRequests.filter(
    (r) => r.incoming && r.status === "pending",
  );
  const renderFriend = (
    friend: (typeof state.friends.items)[number],
    index: number,
  ) => (
    <View
      style={
        friend.status === "accepted"
          ? {
              padding: 14,
              gap: 10,
              borderBottomWidth: index === friends.length - 1 ? 0 : 0.5,
              borderBottomColor: colors.border,
            }
          : [styles.card, { padding: 14 }]
      }
      key={friend.userId}
    >
      <View style={styles.row}>
        <View>
          <Avatar name={friend.remark || friend.displayName} />
          <View
            style={{
              position: "absolute",
              width: 10,
              height: 10,
              borderRadius: 5,
              right: 0,
              bottom: 0,
              borderWidth: 2,
              borderColor: colors.surface,
              backgroundColor: friend.online ? colors.green : "#626c80",
            }}
          />
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <View style={[styles.row, { gap: 6 }]}>
            {friend.pinned && <Pin size={12} color={colors.accent} />}
            <Text
              numberOfLines={1}
              style={[styles.heading, { flex: 1, fontSize: 15 }]}
            >
              {friend.remark || friend.displayName}
            </Text>
          </View>
          <Text
            style={[styles.muted, friend.online && { color: colors.green }]}
          >
            {friend.status === "pending"
              ? friend.incoming
                ? "希望添加你为好友"
                : "等待对方同意"
              : friend.online
                ? friend.room
                  ? `房间中（${friend.room.memberCount}/${friend.room.maxMembers}）`
                  : "在线"
                : "离线"}
          </Text>
        </View>
        <IconButton
          icon={MoreHorizontal}
          label={`${friend.displayName}的更多操作`}
          onPress={() => {
            setSelected(friend.userId);
            setRemark(friend.remark || "");
          }}
        />
      </View>
      {friend.status === "pending" && friend.incoming ? (
        <Button
          primary
          icon={Check}
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
      ) : friend.status === "accepted" &&
        ((friend.online && friend.room) || state.room) ? (
        <View style={[styles.row, { flexWrap: "wrap" }]}>
          {friend.online && friend.room && (
            <Button
              icon={LogIn}
              style={{ flexGrow: 1 }}
              disabled={friend.room.memberCount >= friend.room.maxMembers}
              onPress={run(async () => {
                await runtime.api.call("request-join", (c) =>
                  c.POST("/api/v1/friends/{userId}/room-requests", {
                    params: { path: { userId: friend.userId } },
                  }),
                );
                runtime.feedback.show({
                  text: "申请已发送，好友同意后将自动加入房间",
                  tone: "success",
                });
              })}
            >
              {friend.room.memberCount >= friend.room.maxMembers
                ? "房间已满"
                : "申请加入"}
            </Button>
          )}
          {state.room && (
            <Button
              icon={Mail}
              style={{ flexGrow: 1 }}
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
      ) : null}
    </View>
  );
  return (
    <Screen
      title="好友"
      actions={
        <IconButton
          icon={UserPlus}
          label="添加好友"
          onPress={() => router.push("/add-friend")}
        />
      }
    >
      <View style={[styles.card, styles.spread, { paddingVertical: 12 }]}>
        <View style={{ gap: 2 }}>
          <Text style={styles.text}>隐身模式</Text>
          <Label muted>
            {state.visibility === "invisible"
              ? "已开启，对好友显示离线"
              : "已关闭，好友可看到你的状态"}
          </Label>
        </View>
        <Switch
          accessibilityLabel="隐身"
          value={state.visibility === "invisible"}
          trackColor={{ true: colors.accent, false: colors.raised }}
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
      {!!joinRequests.length && (
        <SectionHeading title="入房申请" count={joinRequests.length} />
      )}
      {joinRequests.map((r) => (
        <View style={styles.card} key={r.id}>
          <Label>{r.displayName} 申请加入房间</Label>
          <View style={styles.row}>
            <Button
              primary
              style={{ flex: 1 }}
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
              style={{ flex: 1 }}
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
      {!!state.friends.roomInvitations.length && (
        <SectionHeading
          title="房间邀请"
          count={state.friends.roomInvitations.length}
        />
      )}
      {state.friends.roomInvitations.map((invite) => (
        <View style={styles.card} key={invite.id}>
          <Badge tone="accent">房间邀请</Badge>
          <Label>
            {invite.senderName} 邀请你加入 {invite.roomName}
          </Label>
          <View style={styles.row}>
            <Button
              primary
              style={{ flex: 1 }}
              onPress={action(async () => {
                await runtime.join(invite.roomId, undefined, invite.token);
                if (runtime.snapshot().roomState === "connected") {
                  await runtime.dismissInvite(invite.id);
                  router.push("/room");
                }
              })}
            >
              加入
            </Button>
            <Button
              style={{ flex: 1 }}
              onPress={run(() => runtime.dismissInvite(invite.id))}
            >
              忽略
            </Button>
          </View>
        </View>
      ))}
      {!!incoming.length && (
        <SectionHeading title="好友申请" count={incoming.length} />
      )}
      {incoming.map(renderFriend)}
      <SectionHeading title="我的好友" count={friends.length} />
      {!!friends.length && (
        <View style={styles.group}>{friends.map(renderFriend)}</View>
      )}
      {!friends.length && (
        <EmptyState
          icon={Users}
          title="还没有好友"
          detail="点击右上角，通过用户名添加"
        />
      )}
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
          icon={Pin}
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
          {state.friends.items.find((f) => f.userId === selected)?.pinned
            ? "取消置顶"
            : "置顶好友"}
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
    </Screen>
  );
}
