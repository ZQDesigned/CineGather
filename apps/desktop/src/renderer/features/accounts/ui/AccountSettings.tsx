import { useEffect, useState } from "react";
import { Form, Typography } from "antd";
import { ArrowLeft, ChevronRight, KeyRound, UserRound } from "lucide-react";
import { profileInput } from "@cinegather/contracts";
import { useApp } from "../../../store";
import * as actions from "../../../controller";
import { Button, Input } from "../../rooms/ui/Controls";
import { AccountForm } from "./AccountForm";

function NicknameForm() {
  const user = useApp((s) => s.user);
  const busy = useApp((s) => s.busy);
  const [form] = Form.useForm<{ displayName: string }>();
  const name = Form.useWatch("displayName", form);
  useEffect(() => {
    form.setFieldsValue({ displayName: user?.displayName ?? "" });
  }, [form, user?.displayName]);
  return (
    <Form
      form={form}
      layout="vertical"
      onFinish={(values) =>
        void actions.run(() => actions.changeNickname(values.displayName))
      }
    >
      <Form.Item
        label="昵称"
        name="displayName"
        rules={[
          {
            validator: (_, value) => {
              const result = profileInput.safeParse({ displayName: value });
              return result.success
                ? Promise.resolve()
                : Promise.reject(
                    new Error(result.error.issues[0]?.message ?? "请输入昵称"),
                  );
            },
          },
        ]}
      >
        <Input autoFocus autoComplete="nickname" maxLength={32} />
      </Form.Item>
      <Button
        type="primary"
        aria-label="保存昵称"
        htmlType="submit"
        loading={busy}
        disabled={busy || name?.trim() === user?.displayName}
      >
        保存昵称
      </Button>
    </Form>
  );
}
export function AccountSettings() {
  const user = useApp((s) => s.user);
  const busy = useApp((s) => s.busy);
  const [page, setPage] = useState<"overview" | "nickname" | "password">(
    "overview",
  );
  useEffect(() => setPage("overview"), [user?.id]);
  if (!user) return null;
  if (page !== "overview")
    return (
      <div className="account-subpage">
        <Button
          className="account-back"
          type="text"
          icon={<ArrowLeft size={16} />}
          disabled={busy}
          onClick={() => setPage("overview")}
          aria-label="返回账号与安全"
        >
          账号与安全
        </Button>
        <Typography.Title level={5}>
          {page === "nickname" ? "修改昵称" : "修改密码"}
        </Typography.Title>
        {page === "nickname" ? (
          <NicknameForm />
        ) : (
          <AccountForm mode="password" />
        )}
      </div>
    );
  return (
    <div className="account-overview">
      <p className="account-identity">用户名：{user.username}</p>
      <Button
        className="account-entry"
        aria-label="修改昵称"
        onClick={() => setPage("nickname")}
      >
        <UserRound size={18} />
        <span>修改昵称</span>
        <span className="account-entry-value">{user.displayName}</span>
        <ChevronRight size={16} />
      </Button>
      <Button
        className="account-entry"
        aria-label="修改密码"
        onClick={() => setPage("password")}
      >
        <KeyRound size={18} />
        <span>修改密码</span>
        <ChevronRight className="account-entry-arrow" size={16} />
      </Button>
    </div>
  );
}
