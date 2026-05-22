import { createRoot } from "react-dom/client"
import { ZenbuProvider } from "@zenbujs/core/react"
import { initTheme } from "@/lib/theme"
import "../../main.css"
import { ContextSidebarApp } from "./context-sidebar-app"

initTheme()

createRoot(document.getElementById("root")!).render(
  <ZenbuProvider>
    <ContextSidebarApp />
  </ZenbuProvider>,
)
