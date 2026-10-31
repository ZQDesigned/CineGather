import { useState } from "react";
import { useLocalSearchParams, useNavigation } from "expo-router";
import Slider from "@react-native-community/slider";
import { Check, UserPlus } from "lucide-react-native";
import { memberFriendAction } from "@cinegather/client-core";
import { runtime } from "../runtime";
import {
  useMedia,
  useRuntime,
  useSession,
  action,
} from "../components/use-runtime";
import {
  Sheet,
  UnavailableSheet,
  closeSheet,
  useSheetRoom,
} from "../components/Sheet";
import { Button, Label } from "../components/ui";

export default function MemberOptions() {
  const { userId: selected } = useLocalSearchParams<{ userId?: string }>();
  const navigation = useNavigation();
  const room = useSheetRoom(),
    state = useRuntime(),
    session = useSession(),
    media = useMedia();
  const [memberGain, setMemberGain] = useState(() =>
    selected ? runtime.media.memberGain(selected) : 1,
  );
  const [completedFriend, setCompletedFriend] = useState<{
    userId: string;
    action: "pending" | "accepted";
  }>();
  if (
    !room ||
    !selected ||
    selected === session.user?.id ||
    !media.members.some((m) => m.id === selected)
  )
    return <UnavailableSheet />;
  const owner = room.ownerUserId === session.user?.id;
  const relationship = memberFriendAction(
    session.user?.id,
    selected,
    state.friends.items.find((f) => f.userId === selected),
  );
  const friendAction =
    relationship === "accepted"
      ? relationship
      : completedFriend?.userId === selected
        ? completedFriend.action
        : relationship;
  const work = (operation: () => Promise<unknown>) =>
    action(async () => {
      await operation();
      await runtime.refresh();
    });
  return (
    <Sheet title="成员操作">
      <Label>用户音量 {Math.round(memberGain * 100)}%</Label>
      <Slider
        accessibilityLabel="用户音量"
        minimumValue={0}
        maximumValue={2}
        value={memberGain}
        onValueChange={(value) => {
          setMemberGain(value);
          if (selected) runtime.media.setMemberGain(selected, value);
        }}
        onSlidingComplete={(value) => {
          if (
            state.friends.items.some(
              (f) => f.userId === selected && f.status === "accepted",
            )
          )
            void runtime.api
              .call("friend-volume", (c) =>
                c.PATCH("/api/v1/friends/{userId}/preferences", {
                  params: { path: { userId: selected! } },
                  body: { volume: Math.round(value * 100) },
                }),
              )
              .catch((e) => runtime.fail(e));
        }}
      />
      <Button
        testID="member-add-friend"
        icon={friendAction === "accepted" ? Check : UserPlus}
        disabled={friendAction !== "request" && friendAction !== "accept"}
        onPress={action(async () => {
          if (friendAction !== "request" && friendAction !== "accept") return;
          const token = runtime.session.getToken();
          await runtime.api.call(
            friendAction === "accept" ? "accept-friend" : "add-friend",
            (c) =>
              friendAction === "accept"
                ? c.POST("/api/v1/friends/{userId}/accept", {
                    params: { path: { userId: selected } },
                  })
                : c.POST("/api/v1/friends", { body: { userId: selected } }),
          );
          if (runtime.session.getToken() !== token) return;
          if (navigation.isFocused())
            setCompletedFriend({
              userId: selected,
              action: friendAction === "accept" ? "accepted" : "pending",
            });
          runtime.feedback.show({
            text: friendAction === "accept" ? "已添加好友" : "好友申请已发送",
            tone: "success",
          });
          await runtime.refresh();
        })}
      >
        {friendAction === "accepted"
          ? "已是好友"
          : friendAction === "pending"
            ? "已发送申请"
            : friendAction === "accept"
              ? "同意好友申请"
              : "添加好友"}
      </Button>
      {owner && (
        <>
          <Button
            onPress={work(() =>
              runtime.api.call("mute-member", (c) =>
                c.POST(
                  "/api/v1/rooms/{roomId}/members/{userId}/microphone/mute",
                  {
                    body: {},
                    params: { path: { roomId: room.id, userId: selected! } },
                  },
                ),
              ),
            )}
          >
            关闭麦克风
          </Button>
          <Button
            onPress={work(() =>
              runtime.api.call("toggle-microphone-permission", (c) =>
                c.POST("/api/v1/rooms/{roomId}/members/{userId}/permissions", {
                  params: { path: { roomId: room.id, userId: selected! } },
                  body: {
                    microphoneAllowed:
                      room.memberPermissions?.find((p) => p.userId === selected)
                        ?.microphoneAllowed === false,
                  },
                }),
              ),
            )}
          >
            {room.memberPermissions?.find((p) => p.userId === selected)
              ?.microphoneAllowed === false
              ? "允许开麦"
              : "禁止开麦"}
          </Button>
          <Button
            onPress={work(() =>
              runtime.api.call("stop-accompaniment", (c) =>
                c.POST(
                  "/api/v1/rooms/{roomId}/members/{userId}/accompaniment/stop",
                  {
                    body: {},
                    params: { path: { roomId: room.id, userId: selected! } },
                  },
                ),
              ),
            )}
          >
            关闭伴奏
          </Button>
          <Button
            onPress={work(async () => {
              await runtime.api.call("transfer-owner", (c) =>
                c.POST("/api/v1/rooms/{roomId}/members/{userId}/owner", {
                  params: { path: { roomId: room.id, userId: selected! } },
                }),
              );
              if (navigation.isFocused()) closeSheet();
            })}
          >
            转移房主
          </Button>
          <Button
            danger
            onPress={work(async () => {
              await runtime.api.call("remove-member", (c) =>
                c.DELETE("/api/v1/rooms/{roomId}/members/{userId}", {
                  params: { path: { roomId: room.id, userId: selected! } },
                  body: { ban: false },
                }),
              );
              if (navigation.isFocused()) closeSheet();
            })}
          >
            移出房间
          </Button>
        </>
      )}
    </Sheet>
  );
}
