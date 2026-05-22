import { createRoot } from "react-dom/client"
import { ZenbuProvider } from "@zenbujs/core/react"
import { initTheme } from "@/lib/theme"
import { ExcalidrawApp } from "./excalidraw-app"
import "@excalidraw/excalidraw/index.css"
import "../../main.css"

initTheme()

createRoot(document.getElementById("root")!).render(
  <ZenbuProvider>
    <ExcalidrawApp />
  </ZenbuProvider>,
)
