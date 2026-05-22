import { createRoot } from "react-dom/client";
import { ZenbuProvider } from "@zenbujs/core/react";
import { initTheme } from "@/lib/theme";
import "allotment/dist/style.css";
import "../../main.css";
import { FileTreeSidebarApp } from "./file-tree-sidebar-app";

initTheme();

createRoot(document.getElementById("root")!).render(
  <ZenbuProvider>
    <FileTreeSidebarApp />
  </ZenbuProvider>,
);
