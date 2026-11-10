import React from "react";
import { HotLifecycle } from "../../features/updates/ui/HotLifecycle";
import { createRoot } from "react-dom/client";
import { App } from "../App";
import { MemberOverlay } from "../../features/rooms/ui/MemberOverlay";
import { UIProvider } from "../Provider";
import { NotificationCard } from "../../features/notifications/ui/NotificationCard";
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
        <>
          <HotLifecycle />
          <App />
        </>
      )}
    </UIProvider>
  </React.StrictMode>,
);
