import { createRoot } from "react-dom/client"
import { ZenbuProvider } from "@zenbujs/core/react"
import { initTheme } from "@/lib/theme"
import { PiEventLogApp } from "./pi-event-log-app"
import "../../main.css"

initTheme()

createRoot(document.getElementById("root")!).render(
  <ZenbuProvider>
    <PiEventLogApp />
  </ZenbuProvider>,
)
