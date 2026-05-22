import { scan } from "react-scan"
import { createRoot } from "react-dom/client"
import { ZenbuProvider } from "@zenbujs/core/react"

// scan({ enabled: true })
import { App } from "./components/app"
import { initTheme } from "./lib/theme"
import "allotment/dist/style.css"
import "./main.css"

initTheme()

createRoot(document.getElementById("root")!).render(
  <ZenbuProvider>
    <App />
  </ZenbuProvider>,
)
