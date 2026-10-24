import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./ui/App";
import { MemberOverlay } from "./ui/MemberOverlay";
import { UIProvider } from "./ui/Provider";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <UIProvider overlay={Boolean(window.memberOverlay)}>
      {window.memberOverlay ? <MemberOverlay /> : <App />}
    </UIProvider>
  </React.StrictMode>,
);
