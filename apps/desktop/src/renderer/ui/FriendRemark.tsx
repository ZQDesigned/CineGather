import { Form, Alert } from "antd";
import { useRef, useState } from "react";
import { Button, Input } from "./Controls";
import { ModalShell, useDialogOpen } from "./Modal";
import { useApp, update } from "../store";
import * as actions from "../controller";
export function FriendRemark() {
  const selected = useApp((s) => s.friendRemarkId);
  const friend = useApp((s) =>
    s.friends.find((f) => f.userId === selected && f.status === "accepted"),
  );
  const owner = useRef(useApp.getState().user?.id);
  const [remark, setRemark] = useState(friend?.remark ?? "");
  const [saving, setSaving] = useState(false);
  const open = useDialogOpen();
  const save = async () => {
    if (
      !friend ||
      !open ||
      saving ||
      useApp.getState().user?.id !== owner.current
    )
      return;
    setSaving(true);
    try {
      await actions.updateFriendPreferences(friend.userId, {
        remark: remark.trim(),
      });
      if (
        useApp.getState().user?.id === owner.current &&
        useApp.getState().modal === "friend-remark" &&
        useApp.getState().friendRemarkId === selected
      )
        update({ modal: null });
    } catch (error) {
      if (useApp.getState().user?.id === owner.current) actions.report(error);
    } finally {
      setSaving(false);
    }
  };
  return (
    <ModalShell
      title="设置备注"
      subtitle={friend?.displayName}
      footer={
        <>
          <Button onClick={() => update({ modal: null })}>取消</Button>
          <Button
            type="primary"
            htmlType="submit"
            form="friend-remark"
            loading={saving}
            disabled={!friend || !open}
          >
            保存备注
          </Button>
        </>
      }
    >
      {friend ? (
        <Form id="friend-remark" layout="vertical" onFinish={() => void save()}>
          <Form.Item label="好友备注">
            <Input
              aria-label="好友备注"
              autoFocus
              allowClear
              showCount
              maxLength={50}
              value={remark}
              onChange={(event) => setRemark(event.target.value)}
              placeholder="输入备注，留空可恢复昵称"
            />
          </Form.Item>
        </Form>
      ) : (
        <Alert type="warning" title="好友关系已变更，请关闭后重试" />
      )}
    </ModalShell>
  );
}
