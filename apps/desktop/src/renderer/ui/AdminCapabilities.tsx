import type { RetainedDialogProps } from "./useRetainedDialog";
import {
  App,
  Button,
  Divider,
  Form,
  Input,
  InputNumber,
  Modal,
  Switch,
} from "antd";
import { useState } from "react";
import { unwrap } from "@cinegather/api-client";
import {
  hasAdminPermission,
  type AdminCapabilitiesInput,
  type AdminPermission,
  type AdminUser,
} from "@cinegather/contracts";
import { api, report } from "../controller";
import { useApp } from "../store";

const fields = [
  {
    key: "screenShareEnabled",
    label: "屏幕共享",
    permission: "users.screen-share",
  },
  {
    key: "highFrameRateEnabled",
    label: "1080p60 共享",
    permission: "users.high-frame-rate",
  },
  {
    key: "esportsRoomsEnabled",
    label: "创建电竞赛事房",
    permission: "users.esports",
  },
  {
    key: "gameHostEnabled",
    label: "发起游戏联机",
    permission: "users.game-host",
  },
  {
    key: "standardRoomMaxMembers",
    label: "普通房创建人数上限",
    permission: "users.room-capacity",
  },
] as const satisfies readonly {
  key: keyof Omit<AdminCapabilitiesInput, "reason">;
  label: string;
  permission: AdminPermission;
}[];

export function AdminCapabilities({
  target,
  open,
  afterClose,
  close,
  saved,
}: {
  target: AdminUser;
  close(): void;
  saved(): void;
} & RetainedDialogProps) {
  const user = useApp((s) => s.user),
    { message } = App.useApp();
  const [form] = Form.useForm<AdminCapabilitiesInput>(),
    [busy, setBusy] = useState(false);
  const canEdit = fields.some((f) => hasAdminPermission(user, f.permission));
  async function submit(values: AdminCapabilitiesInput) {
    const changes: Partial<AdminCapabilitiesInput> = {};
    for (const { key, permission } of fields)
      if (hasAdminPermission(user, permission) && values[key] !== target[key])
        Object.assign(changes, { [key]: values[key] });
    if (!Object.keys(changes).length) {
      void message.info("配置未发生变化");
      return;
    }
    setBusy(true);
    try {
      unwrap(
        await api.PATCH("/api/v1/admin/users/{userId}/capabilities", {
          params: { path: { userId: target.id } },
          body: { ...changes, reason: values.reason },
        }),
      );
      void message.success("账号能力已更新");
      saved();
      close();
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open={open}
      afterClose={afterClose}
      destroyOnHidden
      title="账号能力配置"
      onCancel={() => {
        if (!busy) close();
      }}
      mask={{ closable: !busy }}
      closable={!busy}
      centered
      width={520}
      footer={
        <>
          <Button disabled={busy} onClick={close}>
            取消
          </Button>
          {canEdit && (
            <Button
              type="primary"
              htmlType="submit"
              form="account-capabilities"
              aria-label="保存配置"
              aria-busy={busy}
              loading={busy}
            >
              保存配置
            </Button>
          )}
        </>
      }
    >
      <p>
        {target.displayName}（{target.username}）
      </p>
      <Form
        form={form}
        id="account-capabilities"
        layout="vertical"
        initialValues={{ ...target, reason: "" }}
        onFinish={(v) => void submit(v)}
        disabled={busy}
      >
        <Divider titlePlacement="start">共享能力</Divider>
        {fields.slice(0, 2).map(({ key, label, permission }) => (
          <div
            key={key}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              minHeight: 44,
              gap: 16,
            }}
          >
            <span>{label}</span>
            <Form.Item noStyle name={key} valuePropName="checked">
              <Switch
                aria-label={label}
                disabled={busy || !hasAdminPermission(user, permission)}
              />
            </Form.Item>
          </div>
        ))}
        <Divider titlePlacement="start">房间能力</Divider>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            minHeight: 44,
            gap: 16,
            marginBottom: 16,
          }}
        >
          <span>创建电竞赛事房</span>
          <Form.Item noStyle name="esportsRoomsEnabled" valuePropName="checked">
            <Switch
              aria-label="创建电竞赛事房"
              disabled={busy || !hasAdminPermission(user, "users.esports")}
            />
          </Form.Item>
        </div>
        <Form.Item
          name="standardRoomMaxMembers"
          label="普通房创建人数上限"
          layout="horizontal"
          labelAlign="left"
          labelCol={{ flex: "auto" }}
          wrapperCol={{ flex: "0 0 90px" }}
          colon={false}
          rules={[
            {
              required: true,
              type: "integer",
              min: 10,
              max: 25,
              message: "请输入 10–25 的整数",
            },
          ]}
        >
          <InputNumber
            aria-label="普通房创建人数上限"
            style={{ width: "100%" }}
            min={10}
            max={25}
            precision={0}
            disabled={busy || !hasAdminPermission(user, "users.room-capacity")}
          />
        </Form.Item>
        <Divider titlePlacement="start">联机能力</Divider>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            minHeight: 44,
            gap: 16,
            marginBottom: 16,
          }}
        >
          <span>发起游戏联机</span>
          <Form.Item noStyle name="gameHostEnabled" valuePropName="checked">
            <Switch
              aria-label="发起游戏联机"
              disabled={busy || !hasAdminPermission(user, "users.game-host")}
            />
          </Form.Item>
        </div>
        {canEdit && (
          <Form.Item
            name="reason"
            label="修改原因"
            rules={[
              {
                required: true,
                whitespace: true,
                min: 2,
                max: 200,
                message: "请填写 2–200 字修改原因",
              },
            ]}
          >
            <Input.TextArea maxLength={200} rows={2} />
          </Form.Item>
        )}
      </Form>
    </Modal>
  );
}
