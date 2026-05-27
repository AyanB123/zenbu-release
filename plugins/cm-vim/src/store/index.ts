import { useSyncExternalStore } from "react"

/**
 * Singleton vim-mode store, shared by the registered CodeMirror
 * extension (writer) and the status-bar item (reader). Lives at a
 * stable module path so all importers get the same instance even
 * when the function-registry's source file is hot-reloaded.
 */

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

export function normalizeVimMode(raw: string | undefined): VimMode {
  if (!raw) return "normal"
  const base = raw.split(" ")[0]
  if (base === "insert" || base === "visual" || base === "replace") return base
  return "normal"
}
