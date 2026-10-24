import { Form, Input, Select, Button } from "antd";
import { useEffect, useState } from "react";
import { MAX_ROOM_MEMBERS } from "@cinegather/contracts";
import { useApp, update } from "../store";
import * as actions from "../controller";
import { ModalShell, useDialogOpen } from "./Modal";
export function RoomSettings() {
  const room = useApp((s) => s.room);
  const busy = useApp((s) => s.busy);
  const members = useApp((s) => s.media.participants.length);
  const open = useDialogOpen();
  const [form] = Form.useForm<{ name: string; maxMembers: number }>();
  // Capture the opening values. Background room polling must retain the draft.
  const [initial] = useState(() => ({
    name: room?.name ?? "",
    maxMembers: room?.maxMembers ?? 5,
  }));
  useEffect(() => {
    if (open && room?.role !== "owner") update({ modal: null });
  }, [open, room?.role]);
  return (
    <ModalShell
      title="房间设置"
      footer={
        <>
          <Button disabled={busy} onClick={() => update({ modal: null })}>
            取消
          </Button>
          <Button
            type="primary"
            htmlType="submit"
            form="room-settings"
            loading={busy}
          >
            保存修改
          </Button>
        </>
      }
    >
      <Form
        id="room-settings"
        form={form}
        layout="vertical"
        initialValues={initial}
        disabled={busy || room?.role !== "owner"}
        onFinish={({ name, maxMembers }) =>
          void actions.run(() =>
            actions.updateRoomSettings(name.trim(), maxMembers),
          )
        }
      >
        <Form.Item
          name="name"
          label="房间名称"
          rules={[
            { required: true, whitespace: true, message: "请输入房间名称" },
            { max: 64, message: "房间名称最多 64 个字符" },
          ]}
        >
          <Input autoFocus maxLength={64} showCount />
        </Form.Item>
        <Form.Item
          name="maxMembers"
          label="人数上限"
          rules={[{ required: true, message: "请选择人数上限" }]}
        >
          <Select
            options={Array.from({ length: MAX_ROOM_MEMBERS - 1 }, (_, i) => ({
              value: i + 2,
              label: `${i + 2} 人`,
              disabled: i + 2 < members,
            }))}
          />
        </Form.Item>
      </Form>
    </ModalShell>
  );
}
