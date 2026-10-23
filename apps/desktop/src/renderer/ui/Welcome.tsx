import { Button, Input, Form, Tabs } from "antd";
import { useState } from "react";
import {
  SlidersHorizontal,
  Headphones,
  MonitorUp,
  Shield,
  ArrowRight,
  Clapperboard,
} from "lucide-react";
import { useApp, update } from "../store";
import * as actions from "../controller";
import { AccountForm } from "./AccountForm";
export function Welcome() {
  const [name, setName] = useState("");
  const busy = useApp((s) => s.busy);
  const [guest, setGuest] = useState(false);
  return (
    <section className="welcome">
      <div className="welcome-art">
        <h1>
          相隔千里，
          <br />
          也能<span>坐在一起。</span>
        </h1>
        <p>
          一个画面，几位朋友。
          <br />
          打开麦克风，把平常的夜晚变成共同的回忆。
        </p>
        <div className="welcome-features">
          <span>
            <Headphones size={17} />
            实时语音
          </span>
          <span>
            <MonitorUp size={17} />
            屏幕共享
          </span>
          <span>
            <Shield size={17} />
            邀请加入
          </span>
        </div>
        <div className="orbital">
          <div className="orbit one" />
          <div className="orbit two" />
          <div className="orbit three" />
          <div className="orbit-center">
            <Clapperboard size={65} strokeWidth={1.1} />
          </div>
        </div>
      </div>
      <div className="welcome-card">
        {!guest ? (
          <>
            <h2>欢迎来到映聚</h2>
            <Tabs
              destroyOnHidden
              items={[
                {
                  key: "login",
                  label: "登录",
                  children: <AccountForm mode="login" />,
                },
                {
                  key: "register",
                  label: "注册",
                  children: <AccountForm mode="register" />,
                },
              ]}
            />
            <Button type="link" onClick={() => setGuest(true)}>
              访客体验
            </Button>
          </>
        ) : (
          <Form
            layout="vertical"
            onFinish={() => {
              void actions.run(() => actions.guest(name));
            }}
          >
            <h2>给自己一个名字</h2>
            <Form.Item
              label="你的昵称"
              name="displayName"
              rules={[
                { required: true, whitespace: true, message: "请输入你的昵称" },
              ]}
            >
              <Input
                autoFocus
                placeholder="朋友们怎么称呼你？"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={32}
                required
              />
            </Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              block
              loading={busy}
              disabled={busy || !name.trim()}
            >
              {busy ? "正在准备…" : "进入映聚"}
              <ArrowRight size={18} />
            </Button>
            <Button type="link" onClick={() => setGuest(false)}>
              返回登录
            </Button>
          </Form>
        )}
        <Button
          type="link"
          htmlType="button"
          onClick={() => update({ modal: "settings" })}
        >
          <SlidersHorizontal size={14} />
          连接自托管服务器
        </Button>
      </div>
    </section>
  );
}
