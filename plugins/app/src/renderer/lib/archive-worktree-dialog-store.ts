import { useSyncExternalStore } from "react"

type State = { open: boolean; scopeId: string | null }

let state: State = { open: false, scopeId: null }
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

/** Open the "Archive worktree" confirmation dialog for `scopeId`.
 * Any component can call this without prop drilling — both the
 * agent sidebar's row-overflow menu and the command palette
 * "Archive worktree" entry route here so the same confirmation
 * UI shows up regardless of entry point. */
export function openArchiveWorktreeDialog(scopeId: string): void {
  state = { open: true, scopeId }
  emit()
}

export function setArchiveWorktreeDialogOpen(open: boolean): void {
  if (open === state.open) return
  // When closing we forget the scope id so a follow-up re-open
  // doesn't accidentally target the previous scope.
  state = open ? { ...state, open: true } : { open: false, scopeId: null }
  emit()
}

/** Subscribe to dialog state. The dialog itself reads this; callers
 * that just want to *open* the dialog should use the imperative
 * `openArchiveWorktreeDialog` instead. */
export function useArchiveWorktreeDialogState(): State {
  return useSyncExternalStore(subscribe, getState, getState)
}
