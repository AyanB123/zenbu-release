type ZenbuBootTrace = {
  mark(name: string): void
}

declare global {
  interface Window {
    __zenbuBootTrace?: ZenbuBootTrace
  }
}

export function markBoot(name: string): void {
  try {
    window.__zenbuBootTrace?.mark(name)
  } catch {
    // Boot tracing must never affect app startup.
  }
}
