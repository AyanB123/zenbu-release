import { useSyncExternalStore } from "react"

export type VimMode = "normal" | "insert" | "visual" | "replace"

let currentMode: VimMode | null = null
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

export function setActiveVimMode(mode: VimMode | null) {
  if (currentMode === mode) return
  currentMode = mode
  emit()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): VimMode | null {
  return currentMode
}

export function useActiveVimMode(): VimMode | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
