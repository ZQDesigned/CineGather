import { useState } from "react";
import { View, Text, Share } from "react-native";
import { Link, Send, Users } from "lucide-react-native";
import { runtime } from "../runtime";
import { useRuntime, useMedia, action } from "./use-runtime";
import { Avatar, Button, EmptyState, styles, colors } from "./ui";
import { Sheet, UnavailableSheet, useSheetRoom } from "./Sheet";

export function InviteFriends() {
  const state = useRuntime(),
    media = useMedia(),
    room = useSheetRoom();
  const [sent, setSent] = useState<Set<string>>(new Set());
  if (!room) return <UnavailableSheet />;
  const roomId = room.id;
  const share = action(async () => {
    const value = await runtime.api.call("invite", (c) =>
      c.POST("/api/v1/rooms/{roomId}/invites", {
        params: { path: { roomId } },
        body: { expiresInHours: 24, maxUses: 10 },
      }),
    );
    await Share.share({
      message: `加入映聚房间「${room.name}」\n${runtime.origin}/?room=${room.code}#invite=${value.token}`,
    });
  });
  const friends = state.friends.items
    .filter((f) => f.status === "accepted")
    .sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) ||
        Number(b.online) - Number(a.online),
    );
  const full = !!state.room && media.members.length >= state.room.maxMembers;
  return (
    <Sheet title="邀请好友">
      {friends.map((friend) => {
        const present = media.members.some((m) => m.id === friend.userId);
        const invited = sent.has(friend.userId);
        return (
          <View key={friend.userId} style={styles.row}>
            <Avatar name={friend.remark || friend.displayName} />
            <View style={{ flex: 1, gap: 3 }}>
              <Text numberOfLines={1} style={styles.heading}>
                {friend.remark || friend.displayName}
              </Text>
              <Text
                style={[styles.muted, friend.online && { color: colors.green }]}
              >
                {friend.online ? "在线" : "离线"}
              </Text>
            </View>
            <Button
              testID={`invite-friend-${friend.userId}`}
              icon={invited || present || full ? undefined : Send}
              disabled={
                !roomId ||
                state.roomState !== "connected" ||
                present ||
                invited ||
                full
              }
              onPress={action(async () => {
                if (!roomId) return;
                await runtime.inviteFriend(friend.userId, roomId);
                setSent((before) => new Set(before).add(friend.userId));
              })}
            >
              {present
                ? "已在房间"
                : invited
                  ? "已邀请"
                  : full
                    ? "房间已满"
                    : "邀请"}
            </Button>
          </View>
        );
      })}
      {!friends.length && (
        <EmptyState
          icon={Users}
          title="还没有可邀请的好友"
          detail="可以通过用户名添加好友，或分享房间链接"
        />
      )}
      <View
        style={{
          borderTopWidth: 0.5,
          borderTopColor: colors.border,
          paddingTop: 14,
        }}
      >
        <Button icon={Link} onPress={share}>
          分享邀请链接
        </Button>
      </View>
    </Sheet>
  );
}
