import { useDb } from "@zenbujs/core/react"
import { useWindowId } from "./window-id"

export const IS_ELECTRON =
  typeof navigator !== "undefined" &&
  navigator.userAgent.toLowerCase().includes("electron")

/** True when the current window is drawing macOS traffic lights —
 * i.e. running inside Electron and not in native fullscreen. UI
 * that reserves gutter space for the lights gates on this. */
export function useHasTrafficLights(): boolean {
  const windowId = useWindowId()
  const fullscreen = useDb(
    root => root.app.windowStates[windowId]?.fullscreen ?? false,
  )
  return IS_ELECTRON && !fullscreen
}
