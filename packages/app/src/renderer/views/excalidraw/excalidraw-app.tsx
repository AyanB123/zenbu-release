import { useEffect, useState } from "react"
import { Excalidraw } from "@excalidraw/excalidraw"
import { useThemeSync } from "@/lib/theme"

/**
 * Pane view that hosts a single Excalidraw canvas. The drawing lives in
 * component state for now; once the host wants persistence we can
 * round-trip the scene through the replica.
 */
export function ExcalidrawApp() {
  useThemeSync()
  const themeType = useThemeType()

  return (
    <div className="excalidraw-host h-full w-full bg-background">
      <Excalidraw theme={themeType} />
    </div>
  )
}

function useThemeType(): "light" | "dark" {
  const get = () =>
    document.documentElement.classList.contains("dark") ? "dark" : "light"
  const [type, setType] = useState<"light" | "dark">(get)
  useEffect(() => {
    const observer = new MutationObserver(() => setType(get()))
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    })
    return () => observer.disconnect()
  }, [])
  return type
}
