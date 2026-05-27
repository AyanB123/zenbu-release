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
 * before the DB hydrates.
 *
 * IMPORTANT: localStorage is synchronous and on first access in an
 * Electron renderer it triggers a one-time disk read of the origin's
 * leveldb backing file. On a cold boot this was measured at 1800ms+
 * of pure JS-thread block — the largest single contributor to
 * iframe time-to-paint. So we deliberately AVOID localStorage on the
 * critical path:
 *
 *   1. Synchronously apply a theme derived from `prefers-color-scheme`
 *      (the OS-level system preference, also sync but backed by
 *      Chromium's already-loaded NativeTheme bridge — no disk read).
 *   2. Asynchronously, on the next idle tick, read localStorage and
 *      switch to the saved preference if it differs. The window for
 *      a visible flash is bounded by `requestIdleCallback` latency,
 *      and the eventual DB-backed `useThemeSync` will reconcile
 *      anyway once the websocket connects.
 */
export function initTheme() {
  // System preference is fast — matchMedia is backed by a cached
  // value from NativeTheme that's already in memory when the renderer
  // starts.
  applyTheme("system")

  // Defer the localStorage probe to an idle callback. If the user has
  // a saved preference that differs from system, we'll switch once
  // the main thread has done its initial paint.
  const idleSwitch = () => {
    try {
      const cached = localStorage.getItem("theme") as
        | Schema["settings"]["theme"]
        | null
      if (cached && cached !== "system") applyTheme(cached)
    } catch {
      // ignore — fallback theme already applied
    }
  }
  if ("requestIdleCallback" in window) {
    ;(window as unknown as {
      requestIdleCallback: (cb: () => void, opts?: { timeout: number }) => void
    }).requestIdleCallback(idleSwitch, { timeout: 500 })
  } else {
    setTimeout(idleSwitch, 0)
  }
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
