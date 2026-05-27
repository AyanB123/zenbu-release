import { useMemo, useRef } from "react"
import { ArchiveRestoreIcon, LayersIcon } from "lucide-react"
import { useDb, useDbClient } from "@zenbujs/core/react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@zenbu/ui/dropdown-menu"
import { Button } from "@zenbu/ui/button"
import { HoverTip } from "@zenbu/ui/hover-tip"
import { useActiveWorkspaceId } from "@/lib/window-state/active-view"
import type { Schema } from "@host/main/schema"

type Scope = Schema["scopes"][string]
type Repo = Schema["repos"][string]

/**
 * Bottom-of-sidebar entrypoint into the "archived worktrees"
 * bucket. Renders nothing when the active workspace has no
 * archived worktrees; the moment one shows up, an abstract
 * stacked-layers icon appears in the footer slot.
 *
 * UI shape: a single `DropdownMenu` listing every archived
 * worktree in the active workspace. Clicking a row flips
 * `archived` back to false and clears `archivedAt`, popping the
 * worktree back into the regular sidebar group list.
 *
 * (Until recently this menu had two parallel sub-menus for
 * "Archived" and "Completed" buckets; the `completed` flag was
 * removed from the schema in migration 73 and everything folded
 * into the single archive bucket.)
 */
export function WorktreeShelfMenu() {
  const activeWorkspaceId = useActiveWorkspaceId()
  const dbClient = useDbClient()
  const buttonRef = useRef<HTMLButtonElement>(null)

  // Subscribe to raw db slices. The selectors here MUST return
  // identities the db replica owns (not freshly-allocated arrays
  // of object literals) — `useDb` compares the returned value
  // across renders with shallow equality, so synthesizing a brand
  // new array of `{ id, label, … }` literals every selector run
  // would cause an infinite re-render loop.
  // (See zenbu-labs/zenbu.js#11.)
  const scopesById = useDb(root => root.app.scopes)
  const reposById = useDb(root => root.app.repos)

  type ShelfEntry = {
    id: string
    label: string
    archivedAt: number | null
  }

  const entries = useMemo<ShelfEntry[]>(() => {
    if (!activeWorkspaceId) return []
    const out: ShelfEntry[] = []
    for (const scope of Object.values(scopesById)) {
      if (scope.workspaceId !== activeWorkspaceId) continue
      if (!scope.archived) continue
      const repoId = scope.repoId
      const repo: Repo | undefined = repoId
        ? reposById[repoId]
        : undefined
      out.push({
        id: scope.id,
        label: labelForScope(scope, repo ?? null),
        archivedAt: scope.archivedAt,
      })
    }
    // Most-recently-archived first so the freshest shelf is at
    // the top. Entries without a timestamp (legacy data
    // pre-migration) fall to the bottom but stay grouped by id so
    // the order is still deterministic.
    out.sort(
      (a, b) =>
        (b.archivedAt ?? 0) - (a.archivedAt ?? 0) ||
        a.id.localeCompare(b.id),
    )
    return out
  }, [activeWorkspaceId, scopesById, reposById])

  const unarchive = (scopeId: string) => {
    void dbClient.update(root => {
      const scope = root.app.scopes[scopeId]
      if (!scope) return
      scope.archived = false
      scope.archivedAt = null
    })
  }

  // Hide the whole control when there's nothing to show. An
  // always-on icon would be visually noisy on a fresh workspace.
  if (entries.length === 0) return null

  const triggerLabel = `Archived worktrees (${entries.length})`

  return (
    <DropdownMenu>
      <HoverTip label={triggerLabel} setAriaLabel={false}>
        <DropdownMenuTrigger asChild>
          <Button
            ref={buttonRef}
            type="button"
            variant="ghost"
            size="icon-xs"
            className="hg-icon size-[22px] rounded bg-transparent text-muted-foreground hover:bg-transparent"
            aria-label={triggerLabel}
          >
            <LayersIcon size={13} />
          </Button>
        </DropdownMenuTrigger>
      </HoverTip>
      <DropdownMenuContent
        align="start"
        side="top"
        sideOffset={6}
        className="max-h-[320px] w-64 overflow-y-auto"
      >
        <DropdownMenuLabel className="flex items-center justify-between text-[11px] font-medium text-muted-foreground">
          <span>Archived</span>
          <span className="tabular-nums">{entries.length}</span>
        </DropdownMenuLabel>
        {entries.map(entry => {
          const subtitle =
            entry.archivedAt != null ? formatRelative(entry.archivedAt) : null
          return (
            <DropdownMenuItem
              key={entry.id}
              onSelect={() => unarchive(entry.id)}
              // Hint at the "click to restore" behavior via the
              // row's primary glyph.
              className="gap-2"
            >
              <ArchiveRestoreIcon className="size-3.5 text-muted-foreground" />
              <span className="flex-1 truncate">{entry.label}</span>
              {subtitle ? (
                <span className="text-[10px] tabular-nums text-muted-foreground">
                  {subtitle}
                </span>
              ) : null}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Label for a scope row: prefer the worktree branch name, fall
 * back to the directory basename. Mirrors `worktreeGroupLabel` in
 * `agent-sidebar-pane.tsx`; kept inline here so this component
 * doesn't reach into the sidebar module. */
function labelForScope(scope: Scope, repo: Repo | null): string {
  if (repo) {
    const wt = repo.worktrees.find(w => w.path === scope.directory)
    if (wt?.branch) return wt.branch
  }
  const parts = scope.directory.split("/").filter(Boolean)
  return parts[parts.length - 1] ?? scope.directory
}

/** Tiny relative-time formatter for the detail rows. Stays
 * lightweight (no Intl.RelativeTimeFormat instantiation per row)
 * since the menu can render dozens of entries. */
function formatRelative(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return "just now"
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  const weeks = Math.floor(days / 7)
  if (weeks < 5) return `${weeks}w ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  const years = Math.floor(days / 365)
  return `${years}y ago`
}
