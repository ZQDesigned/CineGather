import {
  Avatar,
  Badge,
  Button,
  Dropdown,
  Empty,
  List,
  Select,
  Space,
  Tabs,
  Tooltip,
  Typography,
} from "antd";
import styled from "@emotion/styled";
import { UserPlus, X, Pin, PinOff, Pencil, MoreHorizontal } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { unwrap } from "@cinegather/api-client";
import { useApp, update } from "../store";
import * as actions from "../controller";
import {
  friendDisplayName,
  friendPresenceLabel,
  type Friend,
} from "../friends";
import { FriendRoomJoinButton } from "./RoomJoinRequests";

const Surface = styled.section`
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  padding: 24px 28px;
  gap: 20px;
  overflow: hidden;
  .friends-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
  }
  h1 {
    font-size: 24px;
    margin: 0;
  }
  .friends-presence {
    width: 190px;
  }
  .friends-tabs {
    flex: 1;
    min-height: 0;
  }
  .friends-tabs > .ant-tabs-body-holder {
    min-height: 0;
    overflow: auto;
  }
  .friends-list {
    margin-top: 0;
  }
  .friend .ant-list-item-meta {
    align-items: center;
    min-width: 0;
  }
  .friend .ant-list-item-meta-content {
    min-width: 0;
  }
  .friend .ant-list-item-meta-title {
    margin-bottom: 4px;
  }
  .friend .ant-list-item-meta-avatar {
    padding-right: 0;
    margin-right: 14px;
  }
  .friend .ant-list-item-action {
    flex-shrink: 0;
  }
  .friend small {
    display: inline;
    margin: 0;
  }
  .friend-name {
    max-width: 100%;
    display: block;
  }
  .friend-title {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .friend-title .friend-name {
    min-width: 0;
  }
  .friend-title > svg {
    flex-shrink: 0;
    color: var(--purple);
  }
  @media (max-width: 1100px) {
    padding: 16px;
    gap: 16px;
  }
`;

export function Friends() {
  const items = useApp((state) => state.friends);
  const visibility = useApp((state) => state.presenceVisibility);
  const busy = useApp((state) => state.busy);
  const [tab, setTab] = useState("all");
  const surface = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    surface.current?.querySelector(".ant-tabs-body-holder")?.scrollTo(0, 0);
  }, [tab]);
  useEffect(() => {
    void actions.refreshFriends().catch(actions.report);
  }, []);
  const accepted = items.filter((friend) => friend.status === "accepted");
  const online = accepted.filter((friend) => friend.online);
  const requests = items.filter((friend) => friend.status === "pending");
  const incoming = requests.filter((friend) => friend.incoming).length;
  const remove = (friend: Friend) =>
    void actions.run(async () => {
      unwrap(
        await actions.api.DELETE("/api/v1/friends/{userId}", {
          params: { path: { userId: friend.userId } },
        }),
      );
      await actions.refreshFriends();
    });
  const list = (friends: Friend[], empty: string) => (
    <List
      className="friends-list"
      dataSource={friends}
      locale={{
        emptyText: (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={empty} />
        ),
      }}
      renderItem={(friend) => (
        <List.Item
          className="friend"
          key={friend.userId}
          actions={[
            ...(friend.status === "accepted" && friend.online && friend.room
              ? [<FriendRoomJoinButton key="join-room" friend={friend} />]
              : []),
            ...(friend.status === "pending" && friend.incoming
              ? [
                  <Button
                    key="accept"
                    type="primary"
                    onClick={() =>
                      void actions.run(async () => {
                        unwrap(
                          await actions.api.POST(
                            "/api/v1/friends/{userId}/accept",
                            { params: { path: { userId: friend.userId } } },
                          ),
                        );
                        await actions.refreshFriends();
                      })
                    }
                  >
                    接受
                  </Button>,
                ]
              : []),
            ...(friend.status === "accepted"
              ? [
                  <Dropdown
                    key="manage"
                    trigger={["click", "contextMenu"]}
                    menu={{
                      items: [
                        {
                          key: "remark",
                          label: "设置备注",
                          icon: <Pencil size={15} />,
                        },
                        {
                          key: "pin",
                          label: friend.pinned ? "取消置顶" : "置顶好友",
                          icon: friend.pinned ? (
                            <PinOff size={15} />
                          ) : (
                            <Pin size={15} />
                          ),
                        },
                        { type: "divider" },
                        {
                          key: "remove",
                          label: "移除好友",
                          danger: true,
                          icon: <X size={15} />,
                        },
                      ],
                      onClick: ({ key }) => {
                        if (busy) return;
                        if (key === "remark")
                          update({
                            friendRemarkId: friend.userId,
                            modal: "friend-remark",
                          });
                        if (key === "pin")
                          void actions.run(() =>
                            actions.updateFriendPreferences(friend.userId, {
                              pinned: !friend.pinned,
                            }),
                          );
                        if (key === "remove") remove(friend);
                      },
                    }}
                  >
                    <Button
                      type="text"
                      disabled={busy}
                      aria-label={`${friendDisplayName(friend)}的好友操作`}
                      icon={<MoreHorizontal size={18} />}
                    />
                  </Dropdown>,
                ]
              : [
                  <Tooltip
                    key="remove"
                    title={friend.incoming ? "拒绝申请" : "撤回申请"}
                  >
                    <Button
                      type="text"
                      danger
                      aria-label={`移除${friend.displayName}`}
                      icon={<X size={16} />}
                      onClick={() => remove(friend)}
                    />
                  </Tooltip>,
                ]),
          ]}
        >
          <List.Item.Meta
            avatar={
              <Avatar size={42} className="amber">
                {friend.displayName[0]}
              </Avatar>
            }
            title={
              <div className="friend-title">
                {friend.pinned && <Pin size={14} aria-label="已置顶" />}
                <Typography.Text
                  className="friend-name"
                  ellipsis={{ tooltip: friendDisplayName(friend) }}
                  strong
                >
                  {friendDisplayName(friend)}
                </Typography.Text>
              </div>
            }
            description={
              friend.status === "accepted" ? (
                <Space size={12} wrap>
                  <Badge
                    color={friend.online ? "#75c99c" : "#8e93a4"}
                    text={<small>{friendPresenceLabel(friend)}</small>}
                  />
                  {friend.remark && (
                    <Typography.Text
                      type="secondary"
                      ellipsis
                      style={{ maxWidth: 200 }}
                    >
                      {friend.displayName}
                    </Typography.Text>
                  )}
                </Space>
              ) : (
                <small>
                  {friend.incoming ? "邀请你成为好友" : "等待对方接受"}
                </small>
              )
            }
          />
        </List.Item>
      )}
    />
  );
  return (
    <Surface ref={surface} className="friends-page" aria-label="好友">
      <header className="friends-heading">
        <h1>好友</h1>
        <Space size="middle" wrap>
          <Select
            className="friends-presence"
            aria-label="我的在线状态"
            value={visibility}
            placeholder="正在连接"
            options={[
              { value: "online", label: "在线" },
              { value: "invisible", label: "隐身（好友看到离线）" },
            ]}
            onChange={(value: "online" | "invisible") =>
              void actions.run(() => actions.setPresence(value))
            }
          />
          <Button
            type="primary"
            icon={<UserPlus size={16} />}
            onClick={() => update({ modal: "add-friend" })}
          >
            添加好友
          </Button>
        </Space>
      </header>
      <Tabs
        className="friends-tabs"
        activeKey={tab}
        onChange={setTab}
        destroyOnHidden
        items={[
          {
            key: "all",
            label: `全部好友（${accepted.length}）`,
            children: list(accepted, "还没有好友，添加一位朋友吧"),
          },
          {
            key: "online",
            label: `在线好友（${online.length}）`,
            children: list(online, "暂时没有在线好友"),
          },
          {
            key: "requests",
            label: (
              <Badge
                dot={incoming > 0}
                offset={[5, 0]}
              >{`好友申请（${requests.length}）`}</Badge>
            ),
            children: list(requests, "暂无好友申请"),
          },
        ]}
      />
    </Surface>
  );
}
