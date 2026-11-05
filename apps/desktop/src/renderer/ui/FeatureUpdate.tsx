import { useRetainedDialog } from "./useRetainedDialog";
import { useState } from "react";
import { Modal, Button, Space, Typography, Alert } from "antd";
import {
  featureLabels,
  clientUpdateOrigin,
  versionBelow,
} from "@cinegather/contracts";
import { useApp, update } from "../store";
export function FeatureUpdatePrompt() {
  const issue = useApp((s) => s.featureUpdate),
    required = useApp((s) => s.requiredUpdate);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string>();
  const dialog = useRetainedDialog(required ? undefined : issue);
  const shown = dialog.value;
  if (!shown) return null;
  const close = () => {
    update({ featureUpdate: undefined });
  };
  const upgrade = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const bridge = window.desktop?.updates;
      if (!window.desktop) {
        location.reload();
        return;
      }
      if (!bridge) {
        await window.desktop.openExternal(clientUpdateOrigin);
        return;
      }
      const status = await bridge.check();
      if (useApp.getState().featureUpdate !== issue) return;
      if (status.mode === "disabled") {
        await window.desktop.openExternal(clientUpdateOrigin);
        return;
      }
      if (
        !status.latestVersion ||
        (shown.minimumVersion &&
          versionBelow(status.latestVersion, shown.minimumVersion))
      )
        throw Error("满足此功能要求的更新暂未提供，请稍后再试。");
      close();
      update({ modal: "updates" });
    } catch (e) {
      if (useApp.getState().featureUpdate !== shown) return;
      setError(
        e instanceof Error ? e.message : "暂时无法检查更新，请稍后重试。",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={dialog.open}
      afterClose={() => {
        dialog.afterClose();
        setError(undefined);
      }}
      destroyOnHidden
      title="此功能需要更新后使用"
      centered
      zIndex={2100}
      onCancel={close}
      footer={
        <Space>
          <Button onClick={close}>暂不使用</Button>
          <Button type="primary" loading={busy} onClick={() => void upgrade()}>
            {shown.updateKind === "reload" ? "刷新页面" : "检查更新"}
          </Button>
        </Space>
      }
    >
      <Space orientation="vertical" size={12} style={{ width: "100%" }}>
        <Typography.Text>{featureLabels[shown.feature]}</Typography.Text>
        <Typography.Paragraph style={{ margin: 0 }}>
          {shown.reason}
        </Typography.Paragraph>
        {shown.minimumVersion && (
          <Typography.Text type="secondary">
            需要 v{shown.minimumVersion} 或更高版本
          </Typography.Text>
        )}
        {error && <Alert type="warning" showIcon title={error} />}
      </Space>
    </Modal>
  );
}
