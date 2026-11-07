import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./ui/App";
import { MemberOverlay } from "./features/rooms/ui/MemberOverlay";
import { UIProvider } from "./ui/Provider";
import { NotificationCard } from "./features/notifications/ui/NotificationCard";
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
