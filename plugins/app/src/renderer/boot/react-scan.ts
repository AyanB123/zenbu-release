function scheduleIdleWork(callback: () => void): void {
  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(callback, { timeout: 2000 })
    return
  }

  window.setTimeout(callback, 250)
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
