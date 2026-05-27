import { useEffect, useMemo, useState } from "react"
import { CheckIcon, ChevronRightIcon, ChevronsUpDownIcon } from "lucide-react"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@zenbu/ui/collapsible"
import { useDb, useDbClient, useRpc } from "@zenbujs/core/react"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@zenbu/ui/dialog"
import { Button } from "@zenbu/ui/button"
import { Input } from "@zenbu/ui/input"
import { Label } from "@zenbu/ui/label"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@zenbu/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@zenbu/ui/popover"
import { defaultWorktreePath } from "@/lib/worktree-paths"
import { cn } from "@/lib/utils"

export type CreateWorktreeDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string | null
  repoId: string | null
  mainWorktreePath: string | null
  /** Branch the repo's primary worktree is currently on. The
   * "fallback" default source ref when the workspace hasn't pinned
   * its own preference. */
  mainWorktreeBranch: string | null
  /** Explicit per-invocation source ref override (e.g. context-menu
   * "New worktree from <branch>"). When non-null, takes precedence
   * over the workspace's persisted default and does NOT mutate it
   * (the override is one-shot). */
  defaultSourceRef: string | null
  /** Called after the worktree is created so the caller can react (e.g. focus it). */
  onCreated?: (args: { worktreePath: string; branch: string }) => void
}

/**
 * "Create worktree" dialog.
 *
 * Two things are configurable:
 *
 *   1. **Branch name** + **on-disk path** for the new worktree. The
 *      path auto-derives from the branch (`<repo>-<branch>` next to
 *      the main worktree) until the user types in it explicitly.
 *   2. **Source branch** the new branch is cut from. Picker defaults
 *      to:
 *        explicit `defaultSourceRef` (one-shot override from caller)
 *          → workspace's pinned `defaultWorktreeBranch`
 *          → main worktree's current branch.
 *      Selecting a branch in the picker is implicitly a "make this
 *      the workspace default" gesture: we write the choice straight
 *      into `workspace.defaultWorktreeBranch` so the next time the
 *      dialog opens it lands on the same branch. The one-shot
 *      override path (context menu) sidesteps the picker and never
 *      mutates the workspace default.
 */
export function CreateWorktreeDialog({
  open,
  onOpenChange,
  workspaceId,
  repoId,
  mainWorktreePath,
  mainWorktreeBranch,
  defaultSourceRef,
  onCreated,
}: CreateWorktreeDialogProps) {
  const rpc = useRpc()
  const dbClient = useDbClient()

  const workspaceDefaultBranch = useDb(root =>
    workspaceId
      ? root.app.workspaces[workspaceId]?.defaultWorktreeBranch ?? null
      : null,
  )

  // Repo's branches, sorted by most recent activity.
  const branches = useDb(root => {
    if (!repoId) return []
    const repo = root.app.repos[repoId]
    if (!repo) return []
    return [...repo.branches].sort((a, b) => b.lastCommitAt - a.lastCommitAt)
  })

  const effectiveDefaultRef =
    defaultSourceRef ?? workspaceDefaultBranch ?? mainWorktreeBranch ?? null

  const [branch, setBranch] = useState("")
  const [path, setPath] = useState("")
  const [pathTouched, setPathTouched] = useState(false)
  const [sourceRef, setSourceRef] = useState<string | null>(null)
  const [sourcePickerOpen, setSourcePickerOpen] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const derivedPath = useMemo(() => {
    if (!mainWorktreePath) return ""
    const trimmed = branch.trim()
    if (!trimmed) return ""
    return defaultWorktreePath(mainWorktreePath, trimmed)
  }, [branch, mainWorktreePath])

  useEffect(() => {
    if (!open) return
    setBranch("")
    setPath("")
    setPathTouched(false)
    setError(null)
    setSubmitting(false)
    setSourcePickerOpen(false)
    setAdvancedOpen(false)
    setSourceRef(effectiveDefaultRef)
    // Intentionally only sync source ref on open transitions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!pathTouched) setPath(derivedPath)
  }, [derivedPath, pathTouched])

  const canSubmit =
    !!repoId &&
    !!mainWorktreePath &&
    branch.trim().length > 0 &&
    path.trim().length > 0

  const handlePickSource = (name: string) => {
    setSourceRef(name)
    setSourcePickerOpen(false)
    // Persist as the workspace default unless this open was a
    // one-shot override (context-menu "from this branch"), and
    // only pin actual branch names (not raw SHAs).
    if (
      workspaceId &&
      !defaultSourceRef &&
      isLikelyBranchName(name)
    ) {
      void dbClient.update(root => {
        const ws = root.app.workspaces[workspaceId]
        if (ws) ws.defaultWorktreeBranch = name
      })
    }
  }

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!canSubmit || !repoId) return
    setSubmitting(true)
    setError(null)
    try {
      const result = await rpc.app.repos.createWorktree({
        repoId,
        worktreePath: path.trim(),
        branch: branch.trim(),
        sourceRef: sourceRef ?? undefined,
        createBranch: true,
      })
      if (!result.ok) {
        setError(result.error ?? "git worktree add failed")
        setSubmitting(false)
        return
      }
      onCreated?.({ worktreePath: path.trim(), branch: branch.trim() })
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setSubmitting(false)
    }
  }

  const sourceLabel = sourceRef ?? "current HEAD"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px] p-0 gap-0">
        <form onSubmit={handleSubmit}>
          <DialogHeader className="px-5 pt-5 pb-4">
            <DialogTitle className="text-[14px] font-semibold">
              New worktree
            </DialogTitle>
          </DialogHeader>

          <div className="px-5 pb-5 flex flex-col gap-4">
            <Field id="worktree-branch" label="Branch name">
              <Input
                id="worktree-branch"
                autoFocus
                value={branch}
                onChange={e => setBranch(normalizeBranchName(e.target.value))}
                placeholder="my-feature"
                className="h-8 text-[13px]"
              />
            </Field>

            <Field id="worktree-source" label="Branch from">
              <Popover
                open={sourcePickerOpen}
                onOpenChange={setSourcePickerOpen}
              >
                <PopoverTrigger
                  id="worktree-source"
                  type="button"
                  role="combobox"
                  aria-expanded={sourcePickerOpen}
                  className="flex h-8 w-full items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 py-1 text-[13px] outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30"
                >
                  <span className="truncate">{sourceLabel}</span>
                  <ChevronsUpDownIcon className="size-3.5 shrink-0 opacity-50" />
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  className="w-[var(--radix-popover-trigger-width)] p-0"
                >
                  <Command>
                    <CommandInput
                      placeholder="Search branches…"
                      className="h-9"
                    />
                    <CommandList>
                      <CommandEmpty>No branches found.</CommandEmpty>
                      <CommandGroup>
                        {branches.map(b => {
                          const isSelected = b.name === sourceRef
                          return (
                            <CommandItem
                              key={b.name}
                              value={b.name}
                              onSelect={() => handlePickSource(b.name)}
                              className="flex items-center gap-2 text-[13px]"
                            >
                              <span className="flex-1 truncate">{b.name}</span>
                              <CheckIcon
                                className={cn(
                                  "size-3.5 shrink-0 opacity-60",
                                  !isSelected && "invisible",
                                )}
                              />
                            </CommandItem>
                          )
                        })}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </Field>

            <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
              <CollapsibleTrigger className="group flex items-center gap-1 text-[12px] font-medium text-muted-foreground hover:text-foreground">
                <ChevronRightIcon className="size-3.5 transition-transform duration-150 group-data-[state=open]:rotate-90" />
                <span>Advanced</span>
              </CollapsibleTrigger>
              <CollapsibleContent className="overflow-hidden pt-3">
                <Field id="worktree-path" label="Path">
                  <Input
                    id="worktree-path"
                    value={path}
                    onChange={e => {
                      setPath(e.target.value)
                      setPathTouched(true)
                    }}
                    placeholder={derivedPath || "/abs/path/to/worktree"}
                    className="h-8 text-[13px]"
                  />
                </Field>
              </CollapsibleContent>
            </Collapsible>

            {error && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12px] text-destructive whitespace-pre-wrap">
                {error}
              </div>
            )}
          </div>

          <DialogFooter className="px-5 py-3 border-t border-border bg-muted/30 rounded-b-xl">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
              className="h-8 text-[13px]"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={!canSubmit || submitting}
              className="h-8 text-[13px]"
            >
              {submitting ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function Field({
  id,
  label,
  children,
}: {
  id: string
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-[12px] font-medium">
        {label}
      </Label>
      {children}
    </div>
  )
}

/**
 * Heuristic: a "branch-like" ref doesn't look like a SHA. Used so we
 * never pin a raw commit hash from the context-menu override as the
 * workspace default.
 */
function isLikelyBranchName(ref: string): boolean {
  return !/^[0-9a-f]{7,40}$/i.test(ref)
}

/** Collapse runs of whitespace in a branch name to single hyphens.
 * We keep the rest of the input untouched (git is fine with mixed
 * case, slashes, etc.) — this is purely a "space bar shouldn't
 * silently produce an invalid ref" affordance. */
function normalizeBranchName(raw: string): string {
  return raw.replace(/\s+/g, "-")
}
