import { createRoot } from "react-dom/client"
import { ZenbuProvider } from "@zenbujs/core/react"
import { initTheme } from "@/lib/theme"
import { PrApp } from "./pr-app"
import "allotment/dist/style.css"
import "../../main.css"

initTheme()

createRoot(document.getElementById("root")!).render(
  <ZenbuProvider>
    <PrApp />
  </ZenbuProvider>,
)
