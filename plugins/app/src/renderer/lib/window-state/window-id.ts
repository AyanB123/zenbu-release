import { useDb } from "@zenbujs/core/react"

const DEFAULT_WINDOW_ID = "main"

/** `WindowService.openWindow` stamps `?windowId=<id>` into each
 * BrowserWindow's URL; legacy / test mounts fall back to "main". */
function readWindowIdFromUrl(): string {
  if (typeof window === "undefined") return DEFAULT_WINDOW_ID
  const fromUrl = new URLSearchParams(window.location.search).get("windowId")
  return fromUrl && fromUrl.length > 0 ? fromUrl : DEFAULT_WINDOW_ID
}

const CURRENT_WINDOW_ID = readWindowIdFromUrl()

export function useWindowId(): string {
  return CURRENT_WINDOW_ID
}

export function useWindowState() {
  const windowId = useWindowId()
  return useDb(root => root.app.windowStates[windowId])
}
