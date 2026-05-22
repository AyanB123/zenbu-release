import { createRoot } from "react-dom/client"
import { ZenbuProvider } from "@zenbujs/core/react"
import { initTheme } from "@/lib/theme"
import "allotment/dist/style.css"
import "../../main.css"
import { ChatWindowApp } from "./chat-window-app"

initTheme()

createRoot(document.getElementById("root")!).render(
  <ZenbuProvider>
    <ChatWindowApp />
  </ZenbuProvider>,
)
