function scheduleIdleWork(callback: () => void): void {
  const w = window as Window &
    typeof globalThis & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void
    }
  if (typeof w.requestIdleCallback === "function") {
    w.requestIdleCallback(callback, { timeout: 2000 })
    return
  }

  w.setTimeout(callback, 250)
}

function reactScanEnabled(): boolean {
  if (!import.meta.env.DEV) return false
  return new URLSearchParams(window.location.search).has("reactScan")
}

export function installReactScanWhenRequested(): void {
  if (!reactScanEnabled()) return

  scheduleIdleWork(() => {
    void import("react-scan").then(({ scan }) => scan({ enabled: true }))
  })
}
