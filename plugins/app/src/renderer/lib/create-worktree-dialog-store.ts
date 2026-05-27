import { useSyncExternalStore } from "react"

type State = { open: boolean; sourceRef: string | null }

let state: State = { open: false, sourceRef: null }
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

function getState(): State {
  return state
}

/** Open the "Create worktree" dialog, optionally pre-seeded with a
 * source ref (branch name or commit SHA) to branch from. Any
 * component can call this without prop drilling. */
export function openCreateWorktreeDialog(sourceRef: string | null): void {
  state = { open: true, sourceRef }
  emit()
}

export function setCreateWorktreeDialogOpen(open: boolean): void {
  state = { ...state, open }
  emit()
}

/** Subscribe to dialog state. The dialog itself reads this; callers
 * that just want to *open* the dialog should use the imperative
 * `openCreateWorktreeDialog` instead. */
export function useCreateWorktreeDialogState(): State {
  return useSyncExternalStore(subscribe, getState, getState)
}
