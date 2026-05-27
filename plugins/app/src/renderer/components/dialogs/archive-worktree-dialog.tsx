import { useEffect, useRef, useState } from "react"
import { useDb, useRpc } from "@zenbujs/core/react"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@zenbu/ui/dialog"
import { Button } from "@zenbu/ui/button"
import { Checkbox } from "@zenbu/ui/checkbox"
import { Label } from "@zenbu/ui/label"
import { useSidebarActions } from "@/hooks/use-sidebar-actions"
import {
  setArchiveWorktreeDialogOpen,
  useArchiveWorktreeDialogState,
} from "@/lib/archive-worktree-dialog-store"
import { worktreeGroupLabel } from "@/lib/sidebar-helpers"

/**
 * "Archive worktree" confirmation dialog.
 *
 * Surfaced from two entry points — the agent sidebar's row
 * overflow menu and the command palette's "Archive worktree"
 * action — both of which call `openArchiveWorktreeDialog(scopeId)`
 * instead of mutating directly so the user always gets one chance
 * to also delete the underlying worktree directory on disk.
 *
 * UX:
 *   - The "Also delete worktree folder" checkbox is checked by
 *     default; pressing Enter triggers the autofocused "Archive"
 *     primary action with the current checkbox value, so the
 *     common case ("yes, archive and delete") is a single keystroke.
 *   - We refuse to offer disk deletion for the repo's main
 *     worktree — that path is the probe we use for every other git
 *     operation in the workspace and nuking it would break things.
 */
export function ArchiveWorktreeDialog() {
  const state = useArchiveWorktreeDialogState()
  return (
    <Dialog
      open={state.open}
      onOpenChange={setArchiveWorktreeDialogOpen}
    >
      {state.open && state.scopeId ? (
        <ArchiveWorktreeDialogBody scopeId={state.scopeId} />
      ) : null}
    </Dialog>
  )
}

function ArchiveWorktreeDialogBody({ scopeId }: { scopeId: string }) {
  const rpc = useRpc()
  const actions = useSidebarActions()

  // Pull just the bits we need so the dialog doesn't re-render on
  // unrelated scope mutations.
  const scopeInfo = useDb(root => {
    const scope = root.app.scopes[scopeId]
    if (!scope) return null
    const repo = scope.repoId ? root.app.repos[scope.repoId] ?? null : null
    const isMainWorktree =
      !!repo && repo.mainWorktreePath === scope.directory
    return {
      label: worktreeGroupLabel(scope, repo),
      isMainWorktree,
    }
  })

  // Default to "yes, delete the folder" — Enter on the dialog
  // submits with this value. We disable + force-uncheck for the
  // main worktree (see refusal in `removeWorktree`).
  const [deleteFolder, setDeleteFolder] = useState(true)

  // Reset transient state every time the dialog opens against a
  // new scope.
  useEffect(() => {
    setDeleteFolder(true)
  }, [scopeId])

  // If the scope vanished between open and render, close the
  // dialog from an effect — don't dispatch store updates during
  // render.
  useEffect(() => {
    if (!scopeInfo) setArchiveWorktreeDialogOpen(false)
  }, [scopeInfo])

  const submitRef = useRef<HTMLButtonElement | null>(null)

  if (!scopeInfo) return null

  const allowDelete = !scopeInfo.isMainWorktree
  const effectiveDelete = allowDelete && deleteFolder

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault()
    // Always archive the scope record first so the row vanishes
    // from the sidebar immediately, even if the disk removal
    // fails (the user can retry deletion via Finder).
    actions.archiveWorktreeScope(scopeId)
    if (effectiveDelete) {
      // Fire-and-forget: blocking the dialog on `git worktree
      // remove` + `fs.rm` of a potentially huge node_modules
      // tree feels awful, and the user has already committed to
      // archiving. Any failure surfaces in the main-process
      // logs; the user can retry via Finder.
      void rpc.app.repos.removeWorktree({ scopeId }).catch(err => {
        console.error("removeWorktree failed", err)
      })
    }
    setArchiveWorktreeDialogOpen(false)
  }

  return (
    <DialogContent
      className="sm:max-w-[460px] p-0 gap-0"
      // Override Radix's default "focus first focusable" so a bare
      // Enter on the dialog hits the destructive primary action
      // instead of the leading Cancel button.
      onOpenAutoFocus={e => {
        e.preventDefault()
        submitRef.current?.focus()
      }}
    >
      <form onSubmit={handleSubmit}>
        <DialogHeader className="px-5 pt-5 pb-4">
          <DialogTitle className="text-[14px] font-semibold">
            Archive {scopeInfo.label}
          </DialogTitle>
        </DialogHeader>

        <div className="px-5 pb-4 flex flex-col gap-3">
          <label
            htmlFor="archive-delete-folder"
            className={`flex items-center gap-2 text-[13px] ${
              allowDelete
                ? "cursor-pointer"
                : "cursor-not-allowed opacity-60"
            }`}
          >
            <Checkbox
              id="archive-delete-folder"
              checked={effectiveDelete}
              disabled={!allowDelete}
              onCheckedChange={v => setDeleteFolder(v === true)}
            />
            <Label
              htmlFor="archive-delete-folder"
              className="text-[13px] font-medium cursor-[inherit]"
            >
              Also delete worktree folder
            </Label>
          </label>
        </div>

        <DialogFooter className="px-5 py-3 border-t border-border bg-muted/30 rounded-b-xl">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setArchiveWorktreeDialogOpen(false)}
            className="h-8 text-[13px]"
          >
            Cancel
          </Button>
          <Button
            // Focused by `onOpenAutoFocus` above so a bare Enter on
            // the dialog submits with the default (delete = yes) —
            // matches the "default should be yes if I hit enter"
            // requirement.
            ref={submitRef}
            type="submit"
            size="sm"
            className="h-8 text-[13px]"
          >
            Archive
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}
