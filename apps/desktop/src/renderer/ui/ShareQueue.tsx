import { useEffect, useRef, useState } from "react";
import { App, Popover, Flex, Typography, Badge, Empty, Alert } from "antd";
import { ListOrdered } from "lucide-react";
import type { ShareRequest } from "@cinegather/contracts";
import { unwrap } from "@cinegather/api-client";
import { useApp } from "../store";
import { api, report, shareSession } from "../controller";
import { Button } from "./Controls";
export function ShareQueue() {
  const room = useApp((s) => s.room),
    sharer = useApp((s) => s.media.sharer),
    status = useApp((s) => s.roomState),
    shareState = useApp((s) => s.shareState);
  const { notification } = App.useApp();
  const [items, setItems] = useState<ShareRequest[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(false),
    [open, setOpen] = useState(false);
  const noticed = useRef(new Set<string>());
  const roomId = room?.id;
  const own = items.find((r) => r.current);
  const publisher = sharer?.local;
  const start = (requestId: string) => {
    setOpen(false);
    notification.destroy("share-handoff");
    void shareSession.startHandoff(async () =>
      unwrap(
        await api.POST(
          "/api/v1/rooms/{roomId}/share-requests/{requestId}/acquire",
          { params: { path: { roomId: roomId!, requestId } } },
        ),
      ),
    );
  };
  useEffect(() => {
    if (!roomId || status !== "connected") return;
    let active = true,
      pending = false;
    const poll = async () => {
      if (pending) return;
      pending = true;
      try {
        const next = unwrap(
          await api.GET("/api/v1/rooms/{roomId}/share-requests", {
            params: { path: { roomId } },
          }),
        );
        if (active) {
          setItems(next.items);
          setError(false);
          const approved = next.items.find(
            (r) => r.current && r.status === "approved",
          );
          if (!approved) notification.destroy("share-handoff");
          if (approved && !noticed.current.has(approved.id)) {
            noticed.current.add(approved.id);
            notification.info({
              key: "share-handoff",
              title: "可以接棒共享了",
              description: "选择你的共享来源并确认后切换画面。",
              duration: 0,
              actions: (
                <Button type="primary" onClick={() => start(approved.id)}>
                  选择来源
                </Button>
              ),
            });
          }
        }
      } catch {
        if (active) setError(true);
      } finally {
        pending = false;
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 3000);
    return () => {
      active = false;
      clearInterval(timer);
      notification.destroy("share-handoff");
    };
    // Request callbacks use the stable room ID captured by this effect.
  }, [roomId, status]);
  const mutate = async (
    action: "request" | "cancel" | "approve" | "reject",
    requestId?: string,
  ) => {
    if (!roomId || busy) return;
    setBusy(true);
    try {
      const params = { path: { roomId, requestId: requestId! } };
      unwrap(
        action === "request"
          ? await api.POST("/api/v1/rooms/{roomId}/share-requests", { params })
          : action === "cancel"
            ? await api.DELETE("/api/v1/rooms/{roomId}/share-requests", {
                params,
              })
            : action === "approve"
              ? await api.POST(
                  "/api/v1/rooms/{roomId}/share-requests/{requestId}/approve",
                  { params },
                )
              : await api.POST(
                  "/api/v1/rooms/{roomId}/share-requests/{requestId}/reject",
                  { params },
                ),
      );
      setItems(
        unwrap(
          await api.GET("/api/v1/rooms/{roomId}/share-requests", {
            params: { path: { roomId } },
          }),
        ).items,
      );
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  };
  if (!sharer && !items.length) return null;
  return (
    <Popover
      trigger="click"
      open={open}
      onOpenChange={setOpen}
      placement="bottomRight"
      title="共享接棒"
      content={
        <Flex
          vertical
          gap={12}
          style={{ width: 300, maxHeight: 360, overflowY: "auto" }}
        >
          {error && <Alert type="warning" title="暂时无法获取队列" />}
          {!items.length ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="还没有接棒申请"
            />
          ) : (
            items.map((r, i) => (
              <Flex key={r.id} align="center" gap={8}>
                <Typography.Text style={{ flex: 1, minWidth: 0 }} ellipsis>
                  {i + 1}. {r.displayName}
                  {r.current ? "（你）" : ""}
                </Typography.Text>
                {r.status === "approved" ? (
                  <Typography.Text type="secondary">等待确认</Typography.Text>
                ) : (
                  publisher && (
                    <>
                      <Button
                        size="small"
                        disabled={busy || i !== 0}
                        onClick={() => void mutate("approve", r.id)}
                      >
                        同意
                      </Button>
                      <Button
                        size="small"
                        disabled={busy}
                        onClick={() => void mutate("reject", r.id)}
                      >
                        拒绝
                      </Button>
                    </>
                  )
                )}
              </Flex>
            ))
          )}
          {own?.status === "approved" && (
            <Button
              type="primary"
              disabled={busy || !["idle", "failed"].includes(shareState)}
              onClick={() => start(own.id)}
            >
              选择来源并接棒
            </Button>
          )}
          {!publisher &&
            sharer &&
            (own ? (
              <Button disabled={busy} onClick={() => void mutate("cancel")}>
                取消申请
              </Button>
            ) : (
              <Button
                type="primary"
                loading={busy}
                onClick={() => void mutate("request")}
              >
                申请接棒
              </Button>
            ))}
        </Flex>
      }
    >
      <Button aria-label="共享接棒" icon={<ListOrdered size={16} />}>
        <span>共享接棒</span>
        <Badge count={items.length} size="small" />
      </Button>
    </Popover>
  );
}
