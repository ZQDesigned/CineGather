import { Button, Form, Input, InputNumber } from "antd";
import { useEffect, useState } from "react";
import {
  defaultEsportsConfiguration,
  esportsConfigurationSchema,
  type EsportsConfiguration,
} from "@cinegather/contracts";
import { update, useApp } from "../store";
import * as actions from "../controller";
import { ModalShell, useDialogOpen } from "./Modal";
export function EsportsRoomSettings() {
  const room = useApp((s) => s.room),
    snapshot = useApp((s) => s.esports?.snapshot);
  const open = useDialogOpen();
  useEffect(() => {
    if (open && room?.role !== "owner") update({ modal: null });
  }, [open, room?.role]);
  const [name, setName] = useState(room?.name ?? "");
  const [configuration, setConfiguration] = useState<EsportsConfiguration>(() =>
    structuredClone(snapshot?.configuration ?? defaultEsportsConfiguration),
  );
  const [revision] = useState(snapshot?.configurationRevision ?? 1);
  const [busy, setBusy] = useState(false);
  const change = (
    id: string,
    patch: Partial<EsportsConfiguration["groups"][number]>,
  ) =>
    setConfiguration((c) => ({
      ...c,
      groups: c.groups.map((g) => (g.id === id ? { ...g, ...patch } : g)),
    }));
  return (
    <ModalShell
      title="房间设置"
      wide
      footer={
        <>
          <Button disabled={busy} onClick={() => update({ modal: null })}>
            取消
          </Button>
          <Button
            type="primary"
            loading={busy}
            htmlType="submit"
            form="esports-settings"
          >
            保存修改
          </Button>
        </>
      }
    >
      <Form
        id="esports-settings"
        layout="vertical"
        disabled={busy || room?.role !== "owner"}
        onFinish={() => {
          if (!name.trim()) return actions.report(new Error("请输入房间名称"));
          const result = esportsConfigurationSchema.safeParse(configuration);
          if (!result.success)
            return actions.report(
              new Error(result.error.issues[0]?.message ?? "请检查分组设置"),
            );
          setBusy(true);
          void actions
            .run(async () => {
              await actions.esports.settings(
                name.trim(),
                result.data,
                revision,
              );
              await actions.refreshRooms();
              const current = useApp.getState();
              if (
                current.room?.id !== room?.id ||
                current.roomState !== "connected"
              )
                return;
              update({
                room: {
                  ...current.room!,
                  name: name.trim(),
                  maxMembers: result.data.groups.reduce(
                    (n, g) => n + g.playerSeats + g.coachSeats,
                    10,
                  ),
                },
                modal: null,
                notice: "房间设置已更新",
              });
            })
            .finally(() => setBusy(false));
        }}
      >
        <Form.Item label="房间名称">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={64}
          />
        </Form.Item>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(100px,1fr) 76px 76px 48px",
            alignItems: "center",
            gap: 10,
            marginBottom: 10,
          }}
        >
          <span>选手分组</span>
          <span>选手席</span>
          <span>教练席</span>
          <span />
          {configuration.groups.map((g) => (
            <div key={g.id} style={{ display: "contents" }}>
              <Input
                aria-label={`${g.name}名称`}
                value={g.name}
                maxLength={24}
                onChange={(e) => change(g.id, { name: e.target.value })}
              />
              <InputNumber
                aria-label={`${g.name}选手席数`}
                min={1}
                max={5}
                value={g.playerSeats}
                onChange={(v) => {
                  if (v !== null) change(g.id, { playerSeats: v });
                }}
                style={{ width: "100%" }}
              />
              <InputNumber
                aria-label={`${g.name}教练席数`}
                min={0}
                max={2}
                value={g.coachSeats}
                onChange={(v) => {
                  if (v !== null) change(g.id, { coachSeats: v });
                }}
                style={{ width: "100%" }}
              />
              <Button
                type="text"
                danger
                disabled={configuration.groups.length === 1}
                onClick={() =>
                  setConfiguration((c) => ({
                    ...c,
                    groups: c.groups.filter((n) => n.id !== g.id),
                  }))
                }
              >
                删除
              </Button>
            </div>
          ))}
        </div>
        <Button
          disabled={configuration.groups.length >= 6 || busy}
          onClick={() =>
            setConfiguration((c) => ({
              ...c,
              groups: [
                ...c.groups,
                {
                  id: crypto.randomUUID(),
                  name: `分组 ${c.groups.length + 1}`,
                  playerSeats: 5,
                  coachSeats: 0,
                },
              ],
            }))
          }
        >
          添加分组
        </Button>
        <Form.Item label="战术暂停时长（秒）" style={{ marginTop: 24 }}>
          <InputNumber
            min={1}
            max={3600}
            value={configuration.tacticalPauseSeconds}
            onChange={(v) => {
              if (v !== null)
                setConfiguration((c) => ({ ...c, tacticalPauseSeconds: v }));
            }}
          />
        </Form.Item>
      </Form>
    </ModalShell>
  );
}
