import { Alert, Button, Tabs } from "antd";
import {
  SlidersHorizontal,
  Headphones,
  MonitorUp,
  Shield,
  Clapperboard,
} from "lucide-react";
import { useEffect, useState } from "react";
import { unwrap } from "@cinegather/api-client";
import { api } from "../controller";
import { useApp, update } from "../store";
import { AccountForm } from "./AccountForm";
export function Welcome() {
  const enabled = useApp((s) => s.registrationEnabled);
  const [tab, setTab] = useState("login");
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true,
      sequence = 0;
    const load = async () => {
      const request = ++sequence;
      try {
        const policy = unwrap(await api.GET("/api/v1/registration"));
        if (active && request === sequence) {
          update({ registrationEnabled: policy.enabled });
          setFailed(false);
        }
      } catch {
        if (active && request === sequence) {
          update({ registrationEnabled: undefined });
          setFailed(true);
        }
      }
    };
    void load();
    const timer = setInterval(() => void load(), 30000);
    window.addEventListener("focus", load);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("focus", load);
    };
  }, [retry]);

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
          activeKey={tab === "register" && !enabled ? "login" : tab}
          onChange={setTab}
          destroyOnHidden
          items={[
            {
              key: "login",
              label: "登录",
              children: <AccountForm mode="login" />,
            },
            {
              key: "register",
              disabled: !enabled,
              label: "注册",
              children: enabled ? <AccountForm mode="register" /> : null,
            },
          ]}
        />
        {failed ? (
          <Alert
            type="warning"
            showIcon
            title="暂时无法确认注册状态"
            action={
              <Button size="small" onClick={() => setRetry((v) => v + 1)}>
                重试
              </Button>
            }
          />
        ) : enabled === false ? (
          <Alert type="info" showIcon title="当前暂未开放注册" />
        ) : null}
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
