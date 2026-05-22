import { useEffect, useMemo, useState } from "react"
import { useRpc } from "@zenbujs/core/react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export type CreateWorktreeDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  repoId: string | null
  mainWorktreePath: string | null
  defaultSourceRef: string | null
  /** Called after the worktree is created so the caller can react (e.g. focus it). */
  onCreated?: (args: { worktreePath: string; branch: string }) => void
}

export function CreateWorktreeDialog({
  open,
  onOpenChange,
  repoId,
  mainWorktreePath,
  defaultSourceRef,
  onCreated,
}: CreateWorktreeDialogProps) {
  const rpc = useRpc()
  const [branch, setBranch] = useState("")
  const [path, setPath] = useState("")
  const [pathTouched, setPathTouched] = useState(false)
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
  }, [open])

  useEffect(() => {
    if (!pathTouched) setPath(derivedPath)
  }, [derivedPath, pathTouched])

  const canSubmit =
    !!repoId && !!mainWorktreePath && branch.trim().length > 0 && path.trim().length > 0

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
        sourceRef: defaultSourceRef ?? undefined,
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create worktree</DialogTitle>
            <DialogDescription>
              {defaultSourceRef
                ? `Branches off ${defaultSourceRef}.`
                : "Branches off the current HEAD."}
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="worktree-branch">Branch name</Label>
              <Input
                id="worktree-branch"
                autoFocus
                value={branch}
                onChange={e => setBranch(e.target.value)}
                placeholder="my-feature"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="worktree-path">Worktree path</Label>
              <Input
                id="worktree-path"
                value={path}
                onChange={e => {
                  setPath(e.target.value)
                  setPathTouched(true)
                }}
                placeholder={derivedPath || "/abs/path/to/worktree"}
              />
            </div>
            {error && (
              <p className="text-[12px] text-destructive">{error}</p>
            )}
          </div>
          <DialogFooter className="mt-4">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit || submitting}>
              {submitting ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function defaultWorktreePath(mainWorktreePath: string, branch: string): string {
  const parentDir = parentOf(mainWorktreePath)
  const repoName = basenameOf(mainWorktreePath)
  const safeBranch = branch.replace(/[/\\:]+/g, "-")
  return `${parentDir}/${repoName}-${safeBranch}`
}

function parentOf(p: string): string {
  const idx = p.replace(/\/+$/, "").lastIndexOf("/")
  if (idx <= 0) return "/"
  return p.slice(0, idx)
}

function basenameOf(p: string): string {
  const trimmed = p.replace(/\/+$/, "")
  const idx = trimmed.lastIndexOf("/")
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed
}
