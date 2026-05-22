import { createRoot } from "react-dom/client"
import { ZenbuProvider } from "@zenbujs/core/react"
import { initTheme } from "@/lib/theme"
import "../../main.css"
import { GitTreeSidebarApp } from "./git-tree-sidebar-app"

initTheme()

createRoot(document.getElementById("root")!).render(
  <ZenbuProvider>
    <GitTreeSidebarApp />
  </ZenbuProvider>,
)
