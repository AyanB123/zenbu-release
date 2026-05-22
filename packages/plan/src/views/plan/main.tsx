import { createRoot } from "react-dom/client";
import { ZenbuProvider } from "@zenbujs/core/react";
import { PlanApp } from "./plan-app";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <ZenbuProvider>
    <PlanApp />
  </ZenbuProvider>,
);
