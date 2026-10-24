import { Alert, App, Button, Card, Form, Input, Switch } from "antd";
import { useEffect, useState } from "react";
import { unwrap } from "@cinegather/api-client";
import { api, report } from "../controller";

export function AdminRegistration({ revision }: { revision: number }) {
  const { message } = App.useApp();
  const [form] = Form.useForm<{
    enabled: boolean;
    screenShareDefaultEnabled: boolean;
    reason: string;
  }>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(undefined);
    void api
      .GET("/api/v1/admin/registration")
      .then(unwrap)
      .then((policy) => {
        if (active)
          form.setFieldsValue({
            enabled: policy.enabled,
            screenShareDefaultEnabled: policy.screenShareDefaultEnabled,
            reason: "",
          });
      })
      .catch((e) => {
        if (active)
          setError(e instanceof Error ? e.message : "无法加载注册设置");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [revision, retry, form]);
  async function save(values: {
    enabled: boolean;
    screenShareDefaultEnabled: boolean;
    reason: string;
  }) {
    setSaving(true);
    try {
      const policy = unwrap(
        await api.POST("/api/v1/admin/registration", { body: values }),
      );
      form.setFieldsValue({
        enabled: policy.enabled,
        screenShareDefaultEnabled: policy.screenShareDefaultEnabled,
        reason: "",
      });
      void message.success("注册设置已保存");
    } catch (e) {
      report(e);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Card title="注册设置">
      {error && (
        <Alert
          type="error"
          showIcon
          title={error}
          action={<Button onClick={() => setRetry((v) => v + 1)}>重试</Button>}
        />
      )}
      <Form
        form={form}
        layout="vertical"
        onFinish={(values) => void save(values)}
        disabled={loading || saving || !!error}
        style={{ maxWidth: 520 }}
        initialValues={{ enabled: false, screenShareDefaultEnabled: false }}
      >
        <Form.Item
          label="开放注册"
          name="enabled"
          valuePropName="checked"
          extra="关闭后已有账号仍可登录。"
        >
          <Switch
            aria-label="开放注册"
            checkedChildren="开启"
            unCheckedChildren="关闭"
            loading={loading}
          />
        </Form.Item>
        <Form.Item
          label="新注册用户默认允许屏幕共享"
          name="screenShareDefaultEnabled"
          valuePropName="checked"
        >
          <Switch
            aria-label="新注册用户默认允许屏幕共享"
            checkedChildren="开启"
            unCheckedChildren="关闭"
            loading={loading}
          />
        </Form.Item>
        <Form.Item
          label="操作原因"
          name="reason"
          rules={[
            { required: true, whitespace: true, message: "请填写操作原因" },
          ]}
        >
          <Input.TextArea maxLength={500} rows={2} showCount />
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={saving}>
          保存注册设置
        </Button>
      </Form>
    </Card>
  );
}
