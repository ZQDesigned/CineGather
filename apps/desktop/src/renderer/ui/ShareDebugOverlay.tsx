import { useEffect, useState } from "react";
import styled from "@emotion/styled";
import { state, useApp } from "../store";
import { diagnostics } from "../controller";
import { ShareDebugMetrics, type ShareDebugView } from "../share-debug";

const Panel = styled.aside`
  position: absolute;
  z-index: 5;
  top: 12px;
  right: 12px;
  width: 274px;
  max-width: calc(100% - 24px);
  max-height: calc(100% - 24px);
  overflow: hidden;
  pointer-events: none;
  user-select: none;
  border: 1px solid #ffffff24;
  border-radius: 8px;
  padding: 9px 11px;
  background: #0c101bd6;
  color: #f2f0ff;
  font-size: 11px;
  line-height: 1.5;
  font-variant-numeric: tabular-nums;
  box-sizing: border-box;
  header {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 5px;
    font-weight: 600;
  }
  header span,
  p {
    color: #c1bdd2;
    font-size: 10px;
    font-weight: 400;
  }
  p {
    margin: 0;
  }
  dl {
    margin: 0;
  }
  dl > div {
    display: flex;
    justify-content: space-between;
    gap: 10px;
  }
  dt {
    color: #c1bdd2;
    flex-shrink: 0;
  }
  dd {
    margin: 0;
    text-align: right;
    overflow-wrap: anywhere;
    min-width: 0;
  }
`;
export function ShareDebugOverlay({ visible = true }: { visible?: boolean }) {
  const enabled = useApp((s) => s.debugMode);
  const room = useApp((s) => s.room?.id);
  const revision = useApp((s) => s.shareRevision);
  const shareState = useApp((s) => s.shareState);
  const sharer = useApp((s) => s.media.sharer);
  const watching = useApp((s) => s.media.watching);
  const paused = useApp((s) => s.media.videoPaused);
  const role = shareState === "active" || sharer?.local ? "sender" : "receiver";
  const native = role === "sender" && Boolean(window.desktop?.nativeCapture);
  const active =
    enabled && Boolean(room) && (shareState === "active" || Boolean(sharer));
  const [view, setView] = useState<{ at: number; metrics: ShareDebugView }>();
  const [now, setNow] = useState(Date.now());
  const waiting = role === "receiver" && (!watching || paused || !visible);
  useEffect(() => {
    setView(undefined);
    if (!active || waiting) return;
    let disposed = false,
      sequence = 0;
    const metrics = new ShareDebugMetrics(role, native);
    const unsubscribe = diagnostics.subscribeSamples((sample) => {
      if (sample.roomId !== room) return;
      const request = ++sequence;
      void (async () => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const status = native
            ? await Promise.race([
                window.desktop?.diagnostics
                  ?.nativeStatus?.()
                  .catch(() => undefined),
                new Promise<undefined>((resolve) => {
                  timer = setTimeout(() => resolve(undefined), 1000);
                }),
              ])
            : undefined;
          if (
            disposed ||
            request !== sequence ||
            state().room?.id !== room ||
            state().media.revision !== sample.revision
          )
            return;
          setView({
            at: sample.at,
            metrics: metrics.sample({ ...sample, native: status }),
          });
        } finally {
          clearTimeout(timer);
        }
      })();
    });
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      disposed = true;
      unsubscribe();
      clearInterval(timer);
    };
  }, [active, waiting, role, native, room, revision, sharer?.id]);
  if (!active) return null;
  const stale = view && (now - view.at > 7000 || view.metrics.stale);
  return (
    <Panel
      aria-label={role === "sender" ? "推流 Debug 信息" : "观看 Debug 信息"}
    >
      <header>
        Debug / {role === "sender" ? "推流端" : "观看端"}
        <span>
          {waiting
            ? "未采样"
            : stale
              ? "采样已过期"
              : view
                ? "每 2 秒更新"
                : "等待采样"}
        </span>
      </header>
      {waiting ? (
        <p>{!watching ? "尚未加入观看" : "画面接收已暂停"}</p>
      ) : !view ? (
        <p>正在等待共享画面数据…</p>
      ) : (
        <dl>
          {view.metrics.rows.map((row) => (
            <div key={row.label}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </Panel>
  );
}
