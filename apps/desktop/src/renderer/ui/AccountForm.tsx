import { Button, Form, Input } from "antd";
import { useApp } from "../store";
import * as actions from "../controller";

export function AccountForm({
  mode,
}: {
  mode: "login" | "register" | "password";
}) {
  const busy = useApp((s) => s.busy);
  const user = useApp((s) => s.user);
  const registering = mode === "register";
  return (
    <Form
      layout="vertical"
      initialValues={{ displayName: user?.displayName }}
      onFinish={(values: {
        username: string;
        displayName: string;
        password: string;
        currentPassword: string;
      }) =>
        void actions.run(() =>
          mode === "login"
            ? actions.login(values.username, values.password)
            : mode === "password"
              ? actions.changePassword(values.currentPassword, values.password)
              : actions.register(
                  values.username,
                  values.displayName,
                  values.password,
                ),
        )
      }
    >
      {mode !== "password" && (
        <Form.Item
          label="用户名"
          name="username"
          rules={[
            { required: true, message: "请输入用户名" },
            {
              pattern: /^[A-Za-z0-9_]{3,32}$/,
              message: "使用 3–32 位字母、数字或下划线",
            },
          ]}
        >
          <Input
            autoFocus
            autoComplete="username"
            maxLength={32}
            placeholder="用户名"
          />
        </Form.Item>
      )}
      {registering && (
        <Form.Item
          label="昵称"
          name="displayName"
          rules={[{ required: true, whitespace: true, message: "请输入昵称" }]}
        >
          <Input autoComplete="nickname" maxLength={32} />
        </Form.Item>
      )}
      {mode === "password" && (
        <Form.Item
          label="当前密码"
          name="currentPassword"
          rules={[{ required: true, message: "请输入当前密码" }]}
        >
          <Input.Password autoComplete="current-password" maxLength={128} />
        </Form.Item>
      )}
      <Form.Item
        label={mode === "password" ? "新密码" : "密码"}
        name="password"
        rules={[
          { required: true, message: "请输入密码" },
          ...(mode === "login"
            ? []
            : [{ min: 10, max: 128, message: "密码需为 10–128 个字符" }]),
        ]}
      >
        <Input.Password
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          maxLength={128}
          placeholder={mode === "login" ? "密码" : "至少 10 个字符"}
        />
      </Form.Item>
      {mode !== "login" && (
        <Form.Item
          label="确认密码"
          name="confirmation"
          dependencies={["password"]}
          rules={[
            { required: true, message: "请再次输入密码" },
            ({ getFieldValue }) => ({
              validator: (_, value) =>
                !value || value === getFieldValue("password")
                  ? Promise.resolve()
                  : Promise.reject(new Error("两次输入的密码不一致")),
            }),
          ]}
        >
          <Input.Password autoComplete="new-password" maxLength={128} />
        </Form.Item>
      )}
      <Button type="primary" htmlType="submit" block loading={busy}>
        {mode === "login"
          ? "登录映聚"
          : mode === "password"
            ? "修改密码"
            : "注册并登录"}
      </Button>
    </Form>
  );
}
