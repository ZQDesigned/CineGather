import { App as AntApp, ConfigProvider, theme } from "antd";
import zhCN from "antd/locale/zh_CN";
import type { ReactNode } from "react";
import { GlobalStyles, cinemaFont } from "./styles";
export function UIProvider({ children }: { children: ReactNode }) {
  return (
    <ConfigProvider
      locale={zhCN}
      virtual={false}
      theme={{
        algorithm: theme.darkAlgorithm,
        token: {
          colorPrimary: "#bca5ff",
          colorInfo: "#bca5ff",
          colorBgBase: "#0d0f14",
          colorBgContainer: "#151820",
          colorBgElevated: "#191b24",
          colorText: "#e9e9ef",
          colorTextSecondary: "#9298a9",
          colorBorder: "#ffffff20",
          borderRadius: 9,
          controlHeight: 40,
          fontFamily: cinemaFont,
          fontSize: 13,
        },
        components: {
          Modal: { borderRadiusLG: 17 },
          Message: { zIndexPopup: 2100 },
          Notification: { zIndexPopup: 2150 },
          Select: { optionSelectedBg: "#bca5ff25" },
        },
      }}
    >
      <GlobalStyles />
      <AntApp
        message={{ maxCount: 3 }}
        notification={{ placement: "topRight", top: 48 }}
      >
        {children}
      </AntApp>
    </ConfigProvider>
  );
}
