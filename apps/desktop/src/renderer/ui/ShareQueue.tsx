import {
  publishClientNotification,
  resolveClientNotification,
} from "../client-notifications";

import { useCallback, useEffect, useRef, useState } from "react";
import { App, Flex } from "antd";
import { MonitorUp } from "lucide-react";
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
    [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const revision = useRef(0);
  const notices = useRef(new Map<string, string>());
  const roomId = room?.id;
  const connected = status === "connected";
  const own = items.find((r) => r.current);
  const publisher = Boolean(sharer?.local);
  const idle = ["idle", "failed"].includes(shareState);
  const blocked = room?.memberPermissions?.some(
    (p) => p.userId === useApp.getState().user?.id && !p.sharingAllowed,
  );
  const refresh = useCallback(async () => {
    const next = unwrap(
      await api.GET("/api/v1/rooms/{roomId}/share-requests", {
        params: { path: { roomId: roomId! } },
      }),
    );
    if (useApp.getState().room?.id === roomId) setItems(next.items);
  }, [roomId]);
  const mutate = useCallback(
    async (
      action: "request" | "cancel" | "approve" | "reject",
      requestId?: string,
    ) => {
      if (!roomId || pending.current || useApp.getState().room?.id !== roomId)
        return;
      pending.current = true;
      ++revision.current;
      setBusy(true);
      try {
        const params = { path: { roomId, requestId: requestId! } };
        unwrap(
          action === "request"
            ? await api.POST("/api/v1/rooms/{roomId}/share-requests", {
                params,
              })
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
        await refresh();
      } catch (error) {
        report(error);
        // Remove expired requests even when the decision itself was rejected.
        await refresh().catch(() => {});
      } finally {
        pending.current = false;
        setBusy(false);
      }
    },
    [roomId, refresh],
  );
  const start = useCallback(
    (requestId: string) => {
      if (useApp.getState().room?.id !== roomId) return;
      // Keep the notification available after the source picker is cancelled.
      void shareSession.startHandoff(async () =>
        unwrap(
          await api.POST(
            "/api/v1/rooms/{roomId}/share-requests/{requestId}/acquire",
            {
              params: { path: { roomId: roomId!, requestId } },
            },
          ),
        ),
      );
    },
    [roomId],
  );
  useEffect(() => {
    if (!roomId || !connected) return;
    let active = true,
      polling = false;
    const poll = async () => {
      if (polling || pending.current) return;
      polling = true;
      const version = revision.current;
      try {
        const next = unwrap(
          await api.GET("/api/v1/rooms/{roomId}/share-requests", {
            params: { path: { roomId } },
          }),
        );
        if (active && version === revision.current) setItems(next.items);
      } catch {
        // Retain existing actionable notifications through a transient network failure.
      } finally {
        polling = false;
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [roomId, connected]);
  useEffect(
    () => () => {
      for (const key of notices.current.keys()) notification.destroy(key);
      notices.current.clear();
    },
    [notification],
  );
  useEffect(() => {
    // The publisher handles the head of the queue directly in its notification.
    // Other requests become actionable once the preceding one has been resolved.
    const relevant =
      connected && sharer
        ? publisher
          ? items.slice(0, 1)
          : items.filter((r) => r.current)
        : [];
    const keys = new Set(relevant.map((r) => `share-request:${r.id}`));
    for (const key of notices.current.keys()) {
      if (!keys.has(key)) {
        resolveClientNotification(key);
        notification.destroy(key);
        notices.current.delete(key);
      }
    }
    for (const request of relevant) {
      const key = `share-request:${request.id}`;
      const signature = JSON.stringify([
        request,
        publisher,
        busy,
        idle,
        blocked,
      ]);
      if (notices.current.get(key) === signature) continue;
      notices.current.set(key, signature);
      const approved = request.status === "approved";
      if (publisher || approved)
        publishClientNotification({
          eventId: `${key}:${request.status}`,
          groupId: key,
          category: "share-request",
          title: publisher
            ? approved
              ? "已同意共享申请"
              : `${request.displayName} 申请共享`
            : "共享申请已同意",
          body: approved
            ? "选择来源并确认后才会切换共享画面。"
            : "可返回房间处理申请。",
          target: "share",
          roomId: roomId,
          entityId: request.id,
        });
      notification.info({
        key,
        title: publisher
          ? approved
            ? "已同意共享申请"
            : `${request.displayName} 申请共享`
          : approved
            ? "共享申请已同意"
            : "共享申请已发送",
        description: publisher
          ? approved
            ? `等待${request.displayName}选择来源并确认。`
            : "同意后，对方确认共享来源才会切换画面。"
          : approved
            ? "选择共享来源并确认后开始共享。"
            : "等待当前共享者同意。",
        duration: 0,
        closable: false,
        actions: (
          <Flex gap={8}>
            {publisher ? (
              <>
                <Button
                  disabled={busy}
                  onClick={() => void mutate("reject", request.id)}
                >
                  {approved ? "撤销同意" : "拒绝"}
                </Button>
                {!approved && (
                  <Button
                    type="primary"
                    disabled={busy}
                    onClick={() => void mutate("approve", request.id)}
                  >
                    同意
                  </Button>
                )}
              </>
            ) : (
              <>
                <Button
                  disabled={busy || !idle}
                  onClick={() => void mutate("cancel")}
                >
                  取消申请
                </Button>
                {approved && (
                  <Button
                    type="primary"
                    disabled={busy || !idle || blocked}
                    onClick={() => start(request.id)}
                  >
                    选择来源
                  </Button>
                )}
              </>
            )}
          </Flex>
        ),
      });
    }
  }, [
    items,
    publisher,
    sharer,
    connected,
    busy,
    idle,
    blocked,
    mutate,
    start,
    notification,
  ]);
  if (!connected || !sharer || publisher) return null;
  return (
    <Button
      type="text"
      className="control-button"
      disabled={busy || !idle || (!own && blocked)}
      onClick={() => void mutate(own ? "cancel" : "request")}
    >
      <MonitorUp size={21} />
      <span>{own ? "取消申请" : "申请共享"}</span>
    </Button>
  );
}
