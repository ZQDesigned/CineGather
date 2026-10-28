import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./ui/App";
import { MemberOverlay } from "./ui/MemberOverlay";
import { UIProvider } from "./ui/Provider";
import { NotificationCard } from "./ui/NotificationCard";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <UIProvider
      overlay={Boolean(window.memberOverlay || window.notificationCard)}
    >
      {window.notificationCard ? (
        <NotificationCard />
      ) : window.memberOverlay ? (
        <MemberOverlay />
      ) : (
        <App />
      )}
    </UIProvider>
  </React.StrictMode>,
);
