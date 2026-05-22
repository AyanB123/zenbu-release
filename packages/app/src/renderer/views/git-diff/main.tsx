import { createRoot } from "react-dom/client"
import { ZenbuProvider } from "@zenbujs/core/react"
import { initTheme } from "@/lib/theme"
import "../../main.css"
import { GitDiffApp } from "./git-diff-app"

initTheme()

createRoot(document.getElementById("root")!).render(
  <ZenbuProvider>
    <GitDiffApp />
  </ZenbuProvider>,
)
