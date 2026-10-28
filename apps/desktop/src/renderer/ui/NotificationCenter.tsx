import { useState } from "react";
import { Badge, Button, Empty, Flex, Popover, Typography } from "antd";
import { Bell } from "lucide-react";
import { useApp } from "../store";
import {
  notificationInbox,
  openClientNotification,
} from "../client-notifications";
export function NotificationCenter() {
  const items = useApp((state) => state.notifications);
  const user = useApp((state) => state.user);
  const [open, setOpen] = useState(false);
  if (!user) return null;
  const unread = items.filter((item) => !item.read).length;
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger="click"
      placement="bottomRight"
      content={
        <div style={{ width: "min(380px, 80vw)" }} aria-label="通知中心">
          <Flex
            justify="space-between"
            align="center"
            style={{ paddingBottom: 8 }}
          >
            <Typography.Text strong>通知</Typography.Text>
            <Flex gap={4}>
              <Button
                size="small"
                type="text"
                disabled={!unread}
                onClick={() => notificationInbox.read()}
              >
                全部已读
              </Button>
              <Button
                size="small"
                type="text"
                disabled={!items.length}
                onClick={() => notificationInbox.clear()}
              >
                清空
              </Button>
            </Flex>
          </Flex>
          <div style={{ maxHeight: "min(440px, 65vh)", overflowY: "auto" }}>
            {!items.length && (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="暂无通知"
              />
            )}
            {items.map((item) => (
              <article
                key={item.id}
                style={{
                  padding: "12px 4px",
                  borderTop: "1px solid #ffffff10",
                }}
              >
                <Flex gap={8} align="center">
                  {!item.read && <Badge status="error" />}
                  <Typography.Text
                    strong
                    style={{ flex: 1, minWidth: 0 }}
                    ellipsis
                  >
                    {item.title}
                  </Typography.Text>
                  {item.count > 1 && (
                    <Badge count={item.count} color="#655383" />
                  )}
                </Flex>
                {item.body && (
                  <Typography.Paragraph
                    ellipsis={{ rows: 2 }}
                    style={{ margin: "6px 0", color: "#9298a9" }}
                  >
                    {item.body}
                  </Typography.Paragraph>
                )}
                <Flex justify="space-between" align="center">
                  <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                    {new Date(item.createdAt).toLocaleString("zh-CN", {
                      month: "numeric",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </Typography.Text>
                  {item.active &&
                  (!item.expiresAt || item.expiresAt > Date.now()) ? (
                    <Button
                      size="small"
                      type="link"
                      onClick={() => {
                        openClientNotification(item.id);
                        setOpen(false);
                      }}
                    >
                      查看
                    </Button>
                  ) : (
                    <Typography.Text type="secondary">已结束</Typography.Text>
                  )}
                </Flex>
              </article>
            ))}
          </div>
        </div>
      }
    >
      <Button
        type="text"
        size="small"
        aria-label={unread ? `通知，${unread} 条未读` : "通知"}
      >
        <Badge dot={Boolean(unread)}>
          <Bell size={17} />
        </Badge>
      </Button>
    </Popover>
  );
}
