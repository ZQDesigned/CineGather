import { Avatar, Empty, Form, Space } from "antd";
import { Search, UserPlus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { unwrap } from "@cinegather/api-client";
import { Button, Input } from "./Controls";
import { useApp, update } from "../store";
import * as actions from "../controller";

type Match = { userId: string; username: string; displayName: string };

export function FriendSearch() {
  const friends = useApp((state) => state.friends);
  const [username, setUsername] = useState("");
  const [result, setResult] = useState<Match | null>();
  const [searching, setSearching] = useState(false);
  const [sending, setSending] = useState(false);
  const pending = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => pending.current?.abort(), []);

  const search = async () => {
    pending.current?.abort();
    const request = new AbortController();
    pending.current = request;
    setResult(undefined);
    setSearching(true);
    try {
      const data = unwrap(
        await actions.api.GET("/api/v1/friends/search", {
          params: { query: { username: username.trim() } },
          signal: request.signal,
        }),
      );
      if (!request.signal.aborted) setResult(data.user);
    } catch (error) {
      if (!request.signal.aborted) actions.report(error);
    } finally {
      if (!request.signal.aborted) setSearching(false);
    }
  };
  const relationship = friends.find(
    (friend) => friend.userId === result?.userId,
  );
  const requestLabel =
    relationship?.status === "accepted"
      ? "已是好友"
      : relationship
        ? relationship.incoming
          ? "对方已发来申请"
          : "等待对方接受"
        : "发送好友请求";
  const send = async () => {
    if (!result || sending || relationship) return;
    setSending(true);
    try {
      await actions.run(async () => {
        unwrap(
          await actions.api.POST("/api/v1/friends", {
            body: { userId: result.userId },
          }),
        );
        await actions.refreshFriends();
        update({ notice: "好友请求已发送" });
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <Form layout="vertical" onFinish={() => void search()}>
        <Form.Item label="好友用户名">
          <Space.Compact block>
            <Form.Item
              name="username"
              noStyle
              rules={[
                {
                  required: true,
                  whitespace: true,
                  message: "请输入好友的完整用户名",
                },
                {
                  pattern: /^\s*[A-Za-z0-9_]{3,32}\s*$/,
                  message: "用户名为 3–32 位字母、数字或下划线",
                },
              ]}
            >
              <Input
                aria-label="好友用户名"
                placeholder="输入朋友的完整用户名"
                maxLength={64}
                value={username}
                onChange={(event) => {
                  pending.current?.abort();
                  setSearching(false);
                  setResult(undefined);
                  setUsername(event.target.value);
                }}
              />
            </Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              icon={<Search size={16} />}
              loading={searching}
            >
              搜索
            </Button>
          </Space.Compact>
        </Form.Item>
      </Form>
      {result === null ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="未找到该用户"
        />
      ) : result ? (
        <section aria-label="搜索结果" className="friend">
          <Avatar className="amber">{result.displayName[0]}</Avatar>
          <span>
            {result.displayName}
            <small>{result.username}</small>
          </span>
          <Button
            aria-label={requestLabel}
            type={relationship ? "default" : "primary"}
            disabled={Boolean(relationship)}
            loading={sending && !relationship}
            icon={relationship ? undefined : <UserPlus size={16} />}
            onClick={() => void send()}
          >
            {requestLabel}
          </Button>
        </section>
      ) : null}
    </>
  );
}
