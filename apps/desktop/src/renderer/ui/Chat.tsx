import { Button, Input, Empty, Tooltip } from "antd";
import { useEffect, useRef, useState } from "react";
import { MessageCircle, Send } from "lucide-react";
import { useApp } from "../store";
import * as actions from "../controller";
import { unwrap } from "@cinegather/api-client";
export function Chat() {
  const room = useApp((s) => s.room)!;
  const [items, setItems] = useState<
    { id: string; displayName: string; body: string; createdAt: string }[]
  >([]);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const result = unwrap(
          await actions.api.GET("/api/v1/rooms/{roomId}/messages", {
            params: { path: { roomId: room.id } },
          }),
        );
        if (alive) setItems(result.items);
      } catch (error) {
        if (alive) actions.report(error);
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 2500);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [room.id]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [items.length]);
  return (
    <div className="chat">
      <div className="chat-messages">
        {!items.length && (
          <Empty
            className="chat-empty"
            image={<MessageCircle size={28} />}
            description="第一句“在吗”，就从这里开始。"
          />
        )}
        {items.map((item) => (
          <article className="chat-message" key={item.id}>
            <header>
              <strong>{item.displayName}</strong>
              <time>
                {new Date(item.createdAt).toLocaleTimeString("zh-CN", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </time>
            </header>
            <p>{item.body}</p>
          </article>
        ))}
        <div ref={end} />
      </div>
      <form
        className="chat-compose"
        onSubmit={(event) => {
          event.preventDefault();
          if (!body.trim() || sending) return;
          setSending(true);
          void actions
            .run(async () => {
              const message = unwrap(
                await actions.api.POST("/api/v1/rooms/{roomId}/messages", {
                  params: { path: { roomId: room.id } },
                  body: { body },
                  headers: { "Idempotency-Key": crypto.randomUUID() },
                }),
              );
              setItems((previous) => [
                ...previous.filter((m) => m.id !== message.id),
                message,
              ]);
              setBody("");
            })
            .finally(() => setSending(false));
        }}
      >
        <Input
          aria-label="聊天消息"
          placeholder="和朋友说点什么…"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          maxLength={2000}
        />
        <Tooltip title="发送消息">
          <Button
            htmlType="submit"
            type="primary"
            aria-label="发送消息"
            disabled={!body.trim() || sending}
          >
            <Send size={17} />
          </Button>
        </Tooltip>
      </form>
    </div>
  );
}
