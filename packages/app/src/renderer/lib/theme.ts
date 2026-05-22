import { useCallback, useEffect } from "react"
import { useDb, useDbClient } from "@zenbujs/core/react"
import type { Schema } from "../../main/schema"

const DARK_QUERY = "(prefers-color-scheme: dark)"

function applyTheme(preference: Schema["settings"]["theme"]) {
  const isOled = preference === "oled"
  const isDark =
    isOled ||
    preference === "dark" ||
    (preference === "system" && window.matchMedia(DARK_QUERY).matches)
  document.documentElement.classList.toggle("dark", isDark)
  document.documentElement.classList.toggle("oled", isOled)
}

/**
 * Apply the saved theme as soon as possible to avoid a light-mode flash
 * before the DB hydrates. Reads from localStorage if the renderer has
 * cached the last applied preference; otherwise falls back to system.
 */
export function initTheme() {
  const cached =
    (localStorage.getItem("theme") as Schema["settings"]["theme"] | null) ?? "system"
  applyTheme(cached)
}

export function useThemeSync() {
  const preference = useDb(root => root.app.settings.theme)
  useEffect(() => {
    applyTheme(preference)
    localStorage.setItem("theme", preference)
    if (preference !== "system") return
    const media = window.matchMedia(DARK_QUERY)
    const onChange = () => applyTheme("system")
    media.addEventListener("change", onChange)
    return () => media.removeEventListener("change", onChange)
  }, [preference])
}

export function useTheme() {
  const preference = useDb(root => root.app.settings.theme)
  const client = useDbClient()
  const setPreference = useCallback(
    async (next: Schema["settings"]["theme"]) => {
      await client.update(root => {
        root.app.settings.theme = next
      })
    },
    [client],
  )
  return { preference, setPreference }
}
