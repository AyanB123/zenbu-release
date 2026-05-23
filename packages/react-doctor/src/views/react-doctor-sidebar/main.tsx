import { createRoot } from "react-dom/client";
import { ZenbuProvider } from "@zenbujs/core/react";
import { SidebarApp } from "./sidebar-app";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <ZenbuProvider>
    <SidebarApp />
  </ZenbuProvider>,
);
