import { createRoot } from "react-dom/client";
import { ZenbuProvider } from "@zenbujs/core/react";
import { initTheme } from "@/lib/theme";
import "allotment/dist/style.css";
import "../../main.css";
import { FileTreeApp } from "./file-tree-app";

initTheme();

createRoot(document.getElementById("root")!).render(
  <ZenbuProvider>
    <FileTreeApp />
  </ZenbuProvider>,
);
