import { useEffect, useState } from "react";
import { Button, Flex, Typography } from "antd";
import { Bell, X } from "lucide-react";
import type { DesktopNotification } from "@cinegather/contracts";
import { cinemaFont } from "./styles";
export function NotificationCard() {
  const [item, setItem] = useState<DesktopNotification>();
  useEffect(() => {
    const bridge = window.notificationCard!;
    let active = true,
      changed = false;
    const stop = bridge.onChange((value) => {
      changed = true;
      setItem(value);
    });
    void bridge.state().then((value) => {
      if (active && !changed) setItem(value);
    });
    return () => {
      active = false;
      stop();
    };
  }, []);
  return (
    <div
      style={{
        fontFamily: cinemaFont,
        padding: 16,
        height: 160,
        boxSizing: "border-box",
        overflow: "hidden",
      }}
    >
      <style>{"html,body,#root{margin:0;height:100%;overflow:hidden}"}</style>
      <Flex justify="space-between" align="center">
        <Flex gap={8} align="center">
          <Bell size={17} />
          <Typography.Text strong>{item?.title ?? "映聚"}</Typography.Text>
        </Flex>
        <Button
          type="text"
          size="small"
          aria-label="关闭通知"
          icon={<X size={16} />}
          onClick={() => void window.notificationCard!.close()}
        />
      </Flex>
      <Typography.Paragraph ellipsis={{ rows: 2 }} style={{ margin: "8px 0" }}>
        {item?.body}
      </Typography.Paragraph>
      <Button
        size="small"
        type="link"
        onClick={() => void window.notificationCard!.activate()}
      >
        查看详情
      </Button>
    </div>
  );
}
