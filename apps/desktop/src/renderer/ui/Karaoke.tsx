import { Alert, Checkbox, Collapse, Slider, Tag } from "antd";
import { Music2, Mic, MicOff } from "lucide-react";
import { useEffect, useState } from "react";
import type { MediaDiagnostic } from "@cinegather/contracts";
import { useApp } from "../store";
import * as actions from "../controller";
import { Button } from "./Controls";
import { ModalShell, useDialogOpen } from "./Modal";
import { AccompanimentControl } from "./Accompaniment";
import { capabilities } from "../platform";
export function Karaoke() {
  const app = useApp(),
    open = useDialogOpen(),
    stage = app.karaoke;
  const [settings, setSettings] = useState(() => actions.media.singingStatus);
  const [diagnostic, setDiagnostic] = useState<MediaDiagnostic["karaoke"]>();
  const desktop =
    capabilities().desktop &&
    ["darwin", "win32"].includes(window.desktop?.platform ?? "");
  const owner = app.room?.role === "owner";
  useEffect(() => {
    if (!open || !stage?.enabled) return;
    let disposed = false;
    const sample = () =>
      void actions.media
        .detailedDiagnostics()
        .then((d) => {
          if (!disposed) setDiagnostic(d.karaoke);
        })
        .catch(() => {});
    sample();
    const timer = setInterval(sample, 2000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [open, stage?.enabled]);
  if (!stage || !app.room) return null;
  const configure = (value: Partial<typeof settings>) => {
    const next = { ...settings, ...value };
    setSettings(next);
    void actions.media
      .configureSinging(next, next.headphones)
      .catch(actions.report);
  };
  const maximum = (key: "queueMs" | "transportRttMs" | "concealedPercent") => {
    const values =
      diagnostic?.measurements.flatMap((v) =>
        typeof v[key] === "number" ? [v[key]!] : [],
      ) ?? [];
    return values.length ? Math.max(...values).toFixed(1) : "采样中";
  };
  return (
    <ModalShell
      title="合唱验证"
      wide
      footer={
        <>
          {owner && (
            <Button
              disabled={app.busy}
              onClick={() =>
                void actions.run(() => actions.karaokeMode(!stage.enabled))
              }
            >
              {stage.enabled ? "结束合唱" : "开启合唱模式"}
            </Button>
          )}
          {stage.enabled &&
            desktop &&
            (stage.singing ? (
              <Button
                disabled={app.busy}
                onClick={() => void actions.run(() => actions.leaveKaraoke())}
              >
                退出合唱
              </Button>
            ) : (
              <Button
                type="primary"
                disabled={app.busy || stage.singers.length >= 4}
                onClick={() => void actions.run(actions.joinKaraoke)}
              >
                加入合唱
              </Button>
            ))}
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Music2 size={18} />
          <strong>{stage.enabled ? "合唱进行中" : "合唱模式未开启"}</strong>
          <Tag>{stage.singers.length} / 4</Tag>
          <Tag>本地验证版</Tag>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2,minmax(0,1fr))",
            gap: 12,
          }}
        >
          {Array.from({ length: 4 }, (_, index) => {
            const id = stage.singers[index],
              p = app.media.participants.find((p) => p.id === id);
            return (
              <div
                key={index}
                style={{
                  display: "flex",
                  gap: 12,
                  alignItems: "center",
                  padding: 14,
                  border: "1px solid var(--border,#303440)",
                  borderRadius: 12,
                  minWidth: 0,
                }}
              >
                {id && p?.microphone ? <Mic size={18} /> : <MicOff size={18} />}
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {id ? (p?.name ?? "正在连接") : "空闲席位"}
                </span>
                {id && owner && id !== app.user?.id && (
                  <Button
                    size="small"
                    onClick={() =>
                      void actions.run(() => actions.leaveKaraoke(id))
                    }
                  >
                    移出
                  </Button>
                )}
              </div>
            );
          })}
        </div>
        {!desktop && stage.enabled && (
          <Alert
            type="info"
            title="网页版可以收听合唱；加入合唱请使用 Windows 或 macOS 客户端。"
          />
        )}
        {stage.enabled && (
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <AccompanimentControl
              disabled={!stage.singing || app.roomState !== "connected"}
            />
            <span>
              {app.media.participants.some((p) => p.accompaniment)
                ? "伴奏正在播放"
                : "使用应用伴奏播放音乐"}
            </span>
          </div>
        )}
        {stage.enabled && stage.singing && (
          <>
            <Checkbox
              checked={settings.headphones}
              onChange={(e) =>
                configure({
                  headphones: e.target.checked,
                  ...(!e.target.checked ? { monitor: 0 } : {}),
                })
              }
            >
              我正在使用有线耳机
            </Checkbox>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2,minmax(0,1fr))",
                gap: "12px 24px",
              }}
            >
              <label>
                演唱音量 {Math.round(settings.gain * 100)}%
                <Slider
                  ariaLabelForHandle="演唱音量"
                  min={0}
                  max={200}
                  value={settings.gain * 100}
                  tooltip={{ open: false }}
                  onChange={(gain) => configure({ gain: gain / 100 })}
                />
              </label>
              <label>
                混响 {Math.round(settings.reverb * 100)}%
                <Slider
                  ariaLabelForHandle="演唱混响"
                  min={0}
                  max={30}
                  value={settings.reverb * 100}
                  tooltip={{ open: false }}
                  onChange={(reverb) => configure({ reverb: reverb / 100 })}
                />
              </label>
              <label>
                本地耳返 {Math.round(settings.monitor * 100)}%
                <Slider
                  ariaLabelForHandle="本地耳返"
                  min={0}
                  max={50}
                  disabled={!settings.headphones}
                  value={settings.monitor * 100}
                  tooltip={{ open: false }}
                  onChange={(monitor) => configure({ monitor: monitor / 100 })}
                />
              </label>
              <label>
                演唱延迟补偿 {settings.delayMs} ms
                <Slider
                  ariaLabelForHandle="演唱延迟补偿"
                  min={0}
                  max={200}
                  step={5}
                  value={settings.delayMs}
                  tooltip={{ open: false }}
                  onChange={(delayMs) => configure({ delayMs })}
                />
              </label>
            </div>
          </>
        )}
        {stage.enabled && (
          <Collapse
            size="small"
            items={[
              {
                key: "measurements",
                label: "验证数据",
                children: (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: 10,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    <span>网络往返：{maximum("transportRttMs")} ms</span>
                    <span>音频接收缓冲：{maximum("queueMs")} ms</span>
                    <span>音频丢失补偿：{maximum("concealedPercent")}%</span>
                    <span>
                      播放基础延迟：
                      {diagnostic?.playbackBaseMs?.toFixed(1) ?? "采样中"} ms
                    </span>
                    <span
                      style={{
                        gridColumn: "1 / -1",
                        color: "var(--muted,#969bab)",
                      }}
                    >
                      这些是链路分项指标，不代表完整返听延迟。实际合唱效果需结合网络测试。
                    </span>
                  </div>
                ),
              },
            ]}
          />
        )}
      </div>
    </ModalShell>
  );
}
