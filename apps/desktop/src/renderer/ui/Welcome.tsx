import { Button, Tabs } from "antd";
import {
  SlidersHorizontal,
  Headphones,
  MonitorUp,
  Shield,
  Clapperboard,
} from "lucide-react";
import { update } from "../store";
import { AccountForm } from "./AccountForm";
export function Welcome() {
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
