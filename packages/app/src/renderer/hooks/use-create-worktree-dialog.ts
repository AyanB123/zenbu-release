import { useCallback, useState } from "react"

/**
 * Owns the open/closed state of the Create Worktree dialog plus the
 * "source ref" (branch name or commit SHA) it should branch off.
 *
 * Multiple call sites in the agent sidebar want to launch the same
 * dialog: the worktree-list panel's "Create worktree" row, and the
 * "New Chat" split-button dropdown. Centralising the state here keeps
 * those call sites in sync — open the dialog with whatever source ref
 * the active scope's worktree provides, or pass `null` to branch from
 * the current HEAD.
 */
export function useCreateWorktreeDialog() {
  const [open, setOpen] = useState(false)
  const [sourceRef, setSourceRef] = useState<string | null>(null)

  const openDialog = useCallback((ref: string | null) => {
    setSourceRef(ref)
    setOpen(true)
  }, [])

  return { open, setOpen, sourceRef, openDialog }
}
