import { Button, Input, Empty, Tooltip, Alert, Spin } from "antd";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { MessageCircle, Send, ArrowDown } from "lucide-react";
import { useApp } from "../store";
import * as actions from "../controller";
export function Chat({ active = true }: { active?: boolean }) {
  const room = useApp((s) => s.room)!;
  const chat = useApp((s) => s.chat);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const visible = () =>
    active && document.visibilityState === "visible" && document.hasFocus();
  const view = () => actions.chat.setView(visible(), following.current);
  const bottom = () => {
    const element = scroller.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
    following.current = true;
    view();
  };
  useLayoutEffect(() => {
    if (following.current && scroller.current)
      scroller.current.scrollTop = scroller.current.scrollHeight;
    view();
  }, [chat.items, room.id, active]);
  useEffect(() => {
    view();
    window.addEventListener("focus", view);
    window.addEventListener("blur", view);
    document.addEventListener("visibilitychange", view);
    return () => {
      window.removeEventListener("focus", view);
      window.removeEventListener("blur", view);
      document.removeEventListener("visibilitychange", view);
      actions.chat.setView(false, following.current);
    };
  }, [room.id, active]);
  return (
    <div className="chat">
      {chat.failed && (
        <Alert
          type="warning"
          title="暂时无法获取聊天消息"
          action={
            <Button size="small" onClick={() => void actions.chat.sync()}>
              重新获取
            </Button>
          }
        />
      )}
      <div
        className="chat-messages"
        ref={scroller}
        onScroll={() => {
          const element = scroller.current;
          if (!element) return;
          following.current =
            element.scrollHeight - element.scrollTop - element.clientHeight <=
            48;
          view();
        }}
      >
        {chat.loading && !chat.items.length ? (
          <div className="chat-empty">
            <Spin size="small" />
          </div>
        ) : (
          !chat.items.length && (
            <Empty
              className="chat-empty"
              image={<MessageCircle size={28} />}
              description="第一句“在吗”，就从这里开始。"
            />
          )
        )}
        {chat.items.map((item) => (
          <article
            className="chat-message"
            key={item.id}
            data-message-id={item.id}
          >
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
      </div>
      {chat.unread > 0 && (
        <Button
          className="chat-new-messages"
          size="small"
          icon={<ArrowDown size={14} />}
          onClick={bottom}
        >
          查看 {chat.unread} 条新消息
        </Button>
      )}
      <form
        className="chat-compose"
        onSubmit={(event) => {
          event.preventDefault();
          const sent = body.trim();
          if (!sent || sending) return;
          setSending(true);
          void actions
            .sendChatMessage(sent)
            .then(() => {
              setBody((current) => (current.trim() === sent ? "" : current));
              requestAnimationFrame(bottom);
            })
            .catch(actions.report)
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
            loading={sending}
          >
            <Send size={17} />
          </Button>
        </Tooltip>
      </form>
    </div>
  );
}
