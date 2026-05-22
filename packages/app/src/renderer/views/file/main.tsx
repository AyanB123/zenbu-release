import { createRoot } from "react-dom/client";
import { ZenbuProvider } from "@zenbujs/core/react";
import { initTheme } from "@/lib/theme";
import "../../main.css";
import { FileApp } from "./file-app";

initTheme();

createRoot(document.getElementById("root")!).render(
  <ZenbuProvider>
    <FileApp />
  </ZenbuProvider>,
);
