import { useEffect, useState } from "react";
import { App, Alert, Flex, Tag, Typography, Spin } from "antd";
import { Laptop, Smartphone, RefreshCw } from "lucide-react";
import type { DeviceSession } from "@cinegather/contracts";
import { unwrap } from "@cinegather/api-client";
import { api, report, logout } from "../controller";
import { Button } from "./Controls";
export function DeviceSessions() {
  const { modal } = App.useApp();
  const [items, setItems] = useState<DeviceSession[]>([]),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState<string>(),
    [error, setError] = useState(false);
  const refresh = async () => {
    setLoading(true);
    setError(false);
    try {
      setItems(unwrap(await api.GET("/api/v1/accounts/sessions")).items);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void refresh();
  }, []);
  const revoke = (item?: DeviceSession) =>
    modal.confirm({
      title: item ? `退出${item.deviceName}？` : "退出其他所有设备？",
      content: "该设备正在进行的房间语音和共享会立即断开。",
      okText: "退出设备",
      cancelText: "取消",
      okButtonProps: { danger: true },
      onOk: async () => {
        setBusy(item?.id ?? "others");
        try {
          if (item?.current) {
            await logout();
            return;
          }
          unwrap(
            item
              ? await api.DELETE("/api/v1/accounts/sessions/{sessionId}", {
                  params: { path: { sessionId: item.id } },
                })
              : await api.DELETE("/api/v1/accounts/sessions"),
          );
          await refresh();
        } catch (e) {
          report(e);
          throw e;
        } finally {
          setBusy(undefined);
        }
      },
    });
  return (
    <section aria-label="登录设备">
      <Flex justify="space-between" align="center" gap={12}>
        <Typography.Title level={5}>登录设备</Typography.Title>
        <Flex gap={8}>
          <Button
            aria-label="刷新登录设备"
            icon={<RefreshCw size={14} />}
            loading={loading}
            onClick={() => void refresh()}
          />
          <Button
            disabled={Boolean(busy) || !items.some((i) => !i.current)}
            onClick={() => revoke()}
          >
            退出其他设备
          </Button>
        </Flex>
      </Flex>
      {error ? (
        <Alert
          type="error"
          title="暂时无法获取登录设备"
          action={<Button onClick={() => void refresh()}>重试</Button>}
        />
      ) : (
        <Spin spinning={loading}>
          <Flex vertical gap={16}>
            {items.map((item) => (
              <Flex
                key={item.id}
                align="center"
                gap={12}
                style={{
                  borderBottom: "1px solid var(--line)",
                  paddingBottom: 12,
                  minWidth: 0,
                }}
              >
                {/Android|iOS/.test(item.deviceName) ? (
                  <Smartphone size={20} />
                ) : (
                  <Laptop size={20} />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Flex gap={8} align="center" wrap>
                    <Typography.Text strong>{item.deviceName}</Typography.Text>
                    {item.current && <Tag color="purple">当前设备</Tag>}
                    {item.clientVersion && (
                      <Typography.Text type="secondary">
                        v{item.clientVersion}
                      </Typography.Text>
                    )}
                  </Flex>
                  <Typography.Paragraph
                    type="secondary"
                    style={{ margin: 0, fontSize: 12 }}
                  >
                    {item.createdAt
                      ? `登录时间：${new Date(item.createdAt).toLocaleString()}`
                      : "登录时间未知"}
                  </Typography.Paragraph>
                  <Typography.Paragraph
                    type="secondary"
                    style={{ margin: 0, fontSize: 12 }}
                  >
                    {item.lastActiveAt
                      ? `最近活动：${new Date(item.lastActiveAt).toLocaleString()}`
                      : "最近活动时间未知"}
                    {item.loginAddress ? `，登录 IP：${item.loginAddress}` : ""}
                  </Typography.Paragraph>
                </div>
                {!item.current && (
                  <Button
                    danger
                    disabled={Boolean(busy)}
                    loading={busy === item.id}
                    onClick={() => revoke(item)}
                  >
                    退出
                  </Button>
                )}
              </Flex>
            ))}
          </Flex>
        </Spin>
      )}
    </section>
  );
}
