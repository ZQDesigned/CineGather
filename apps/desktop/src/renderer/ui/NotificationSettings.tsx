import { useState } from "react";
import { Alert, Button, Checkbox, Flex, Form, Slider, Switch } from "antd";
import {
  defaultNotificationPreferences,
  type NotificationPreferences,
} from "@cinegather/contracts";
import { previewNotificationSound } from "../client-notifications";
export function NotificationSettings({
  value = defaultNotificationPreferences,
  onChange,
}: {
  value?: NotificationPreferences;
  onChange(value: NotificationPreferences): void;
}) {
  const [permission, setPermission] = useState(
    typeof Notification === "undefined"
      ? "unsupported"
      : Notification.permission,
  );
  const change = <K extends keyof NotificationPreferences>(
    key: K,
    next: NotificationPreferences[K],
  ) => onChange({ ...value, [key]: next });
  return (
    <>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "0 24px",
        }}
      >
        <Form.Item label="启用通知">
          <Switch
            aria-label="启用通知"
            checked={value.enabled}
            onChange={(v) => change("enabled", v)}
          />
        </Form.Item>
        <Form.Item label="免打扰">
          <Switch
            aria-label="免打扰"
            checked={value.doNotDisturb}
            onChange={(v) => change("doNotDisturb", v)}
          />
        </Form.Item>
        <Form.Item label="后台桌面通知">
          <Switch
            aria-label="后台桌面通知"
            checked={value.desktop}
            onChange={(v) => change("desktop", v)}
          />
        </Form.Item>
        <Form.Item label="显示通知正文">
          <Switch
            aria-label="显示通知正文"
            checked={value.preview}
            onChange={(v) => change("preview", v)}
          />
        </Form.Item>
      </div>
      <Form.Item label="提示音">
        <Flex gap={16} align="center">
          <Switch
            aria-label="通知提示音"
            checked={value.sound}
            onChange={(v) => change("sound", v)}
          />
          <Slider
            aria-label="通知提示音音量"
            min={0}
            max={100}
            value={value.volume}
            onChange={(v) => change("volume", v)}
            style={{ flex: 1 }}
          />
          <Button onClick={() => previewNotificationSound(value)}>试听</Button>
        </Flex>
      </Form.Item>
      <Form.Item label="提醒内容">
        <Flex wrap gap={16}>
          {[
            ["chat", "聊天消息"],
            ["friends", "好友申请"],
            ["requests", "房间与共享申请"],
            ["system", "连接与设备提醒"],
          ].map(([key, label]) => (
            <Checkbox
              key={key}
              checked={value[key as "chat"]}
              onChange={(event) => change(key as "chat", event.target.checked)}
            >
              {label}
            </Checkbox>
          ))}
        </Flex>
      </Form.Item>
      {!window.desktop && permission !== "granted" && (
        <Alert
          type="info"
          title={
            permission === "denied"
              ? "请在浏览器站点设置中允许通知"
              : permission === "unsupported"
                ? "当前浏览器不支持桌面通知"
                : "允许浏览器通知后，可在切换标签页时收到提醒"
          }
          action={
            permission === "default" && (
              <Button
                onClick={() =>
                  void Notification.requestPermission().then(setPermission)
                }
              >
                允许通知
              </Button>
            )
          }
        />
      )}
    </>
  );
}
