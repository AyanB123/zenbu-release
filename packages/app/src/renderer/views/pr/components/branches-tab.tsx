import { useMemo, useState } from "react"
import {
  CheckIcon,
  GitBranchIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { GitBranch } from "../types"

/**
 * Branches tab — full-screen branch manager. Lists local +
 * remote branches with checkout/delete/create actions. Useful
 * when you outgrow the toolbar branch picker (which is meant
 * for quick switching).
 */
export function BranchesTab({
  branches,
  busy,
  onCheckout,
  onDelete,
  onCreate,
}: {
  directory: string
  branches: GitBranch[]
  busy: string | null
  onCheckout: (branch: string) => void
  onDelete: (name: string, force: boolean) => void
  onCreate: (name: string, from?: string) => void
}) {
  const [query, setQuery] = useState("")
  const [creating, setCreating] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<GitBranch | null>(null)

  const current = useMemo(
    () => branches.find(b => b.isCurrent)?.shortName ?? null,
    [branches],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return branches
    return branches.filter(b => b.shortName.toLowerCase().includes(q))
  }, [branches, query])

  const local = filtered.filter(b => !b.remote)
  const remote = filtered.filter(b => b.remote)

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 items-center gap-2 border-b px-2 py-1.5">
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Filter branches…"
          className="h-7 flex-1 rounded border bg-background px-2 text-[12px] outline-none focus:ring-1 focus:ring-ring"
        />
        <button
          type="button"
          onClick={() => setCreating(true)}
          disabled={!!busy}
          className="flex h-7 items-center gap-1 rounded border px-2 text-[12px] hover:bg-accent disabled:opacity-40"
        >
          <PlusIcon className="size-3.5" /> New branch
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <BranchGroup
          title="Local"
          items={local}
          current={current}
          busy={busy}
          onCheckout={onCheckout}
          onDelete={b => setConfirmDelete(b)}
        />
        <BranchGroup
          title="Remote"
          items={remote}
          current={current}
          busy={busy}
          onCheckout={b => {
            const short = b.replace(/^[^/]+\//, "")
            onCheckout(short)
          }}
          onDelete={null}
        />
        {filtered.length === 0 && (
          <div className="p-4 text-center text-[12px] text-muted-foreground">
            No branches match.
          </div>
        )}
      </div>

      {creating && (
        <CreateBranchDialog
          from={current ?? "HEAD"}
          onCancel={() => setCreating(false)}
          onCreate={name => {
            onCreate(name)
            setCreating(false)
          }}
        />
      )}
      {confirmDelete && (
        <DeleteBranchDialog
          branch={confirmDelete}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={force => {
            onDelete(confirmDelete.shortName, force)
            setConfirmDelete(null)
          }}
        />
      )}
    </div>
  )
}

function BranchGroup({
  title,
  items,
  current,
  busy,
  onCheckout,
  onDelete,
}: {
  title: string
  items: GitBranch[]
  current: string | null
  busy: string | null
  onCheckout: (shortName: string) => void
  onDelete: ((b: GitBranch) => void) | null
}) {
  if (items.length === 0) return null
  return (
    <div className="py-1">
      <div className="sticky top-0 z-[1] bg-background px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title} · {items.length}
      </div>
      {items.map(b => {
        const active = b.shortName === current
        return (
          <div
            key={b.name}
            className={cn(
              "group flex items-center gap-2 border-b border-transparent px-3 py-1.5 text-[12px]",
              active ? "bg-accent/60" : "hover:bg-accent/30",
            )}
          >
            <GitBranchIcon
              className={cn(
                "size-3.5 shrink-0",
                active ? "text-foreground" : "text-muted-foreground",
              )}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span
                  className={cn(
                    "truncate font-mono text-[12px]",
                    active && "font-medium",
                  )}
                >
                  {b.shortName}
                </span>
                {active && (
                  <CheckIcon className="size-3 shrink-0 text-emerald-500" />
                )}
                {b.upstream && (
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    → {b.upstream}
                  </span>
                )}
              </div>
              <div className="truncate text-[10.5px] text-muted-foreground">
                {b.subject || "(no commits)"}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1 opacity-0 group-hover:opacity-100">
              {!active && (
                <button
                  type="button"
                  onClick={() => onCheckout(b.shortName)}
                  disabled={!!busy}
                  className="rounded border px-2 py-0.5 text-[11px] hover:bg-accent disabled:opacity-40"
                >
                  Checkout
                </button>
              )}
              {onDelete && !active && (
                <button
                  type="button"
                  onClick={() => onDelete(b)}
                  disabled={!!busy}
                  title="Delete branch"
                  className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
                >
                  <Trash2Icon className="size-3.5" />
                </button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function CreateBranchDialog({
  from,
  onCancel,
  onCreate,
}: {
  from: string
  onCancel: () => void
  onCreate: (name: string) => void
}) {
  const [name, setName] = useState("")
  return (
    <div
      className="absolute inset-0 z-10 flex items-center justify-center bg-background/80 p-4"
      onClick={onCancel}
    >
      <form
        onClick={e => e.stopPropagation()}
        onSubmit={e => {
          e.preventDefault()
          if (!name.trim()) return
          onCreate(name.trim())
        }}
        className="w-[340px] rounded-md border bg-background p-3 shadow-md"
      >
        <div className="mb-2 text-[12px] font-medium">New branch</div>
        <label className="mb-1 block text-[11px] text-muted-foreground">
          Branch from {from}
        </label>
        <input
          autoFocus
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="feature/my-branch"
          className="mb-3 w-full rounded border bg-background px-2 py-1 text-[12px] outline-none focus:ring-1 focus:ring-ring"
        />
        <div className="flex justify-end gap-1">
          <button
            type="button"
            onClick={onCancel}
            className="rounded px-2 py-1 text-[12px] hover:bg-accent"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!name.trim()}
            className="rounded bg-primary px-2 py-1 text-[12px] font-medium text-primary-foreground disabled:opacity-40"
          >
            Create &amp; checkout
          </button>
        </div>
      </form>
    </div>
  )
}

function DeleteBranchDialog({
  branch,
  onCancel,
  onConfirm,
}: {
  branch: GitBranch
  onCancel: () => void
  onConfirm: (force: boolean) => void
}) {
  return (
    <div
      className="absolute inset-0 z-10 flex items-center justify-center bg-background/80 p-4"
      onClick={onCancel}
    >
      <div
        className="w-[340px] rounded-md border bg-background p-3 shadow-md"
        onClick={e => e.stopPropagation()}
      >
        <div className="mb-1 text-[12px] font-medium">Delete branch</div>
        <p className="mb-3 text-[12px] text-muted-foreground">
          Delete <span className="font-mono">{branch.shortName}</span>? Force
          delete drops unmerged commits.
        </p>
        <div className="flex justify-end gap-1">
          <button
            type="button"
            onClick={onCancel}
            className="rounded px-2 py-1 text-[12px] hover:bg-accent"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(false)}
            className="rounded border px-2 py-1 text-[12px] hover:bg-accent"
          >
            Delete
          </button>
          <button
            type="button"
            onClick={() => onConfirm(true)}
            className="rounded bg-destructive px-2 py-1 text-[12px] font-medium text-destructive-foreground"
          >
            Force delete
          </button>
        </div>
      </div>
    </div>
  )
}
