import { useMemo, useRef } from "react"
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  CheckCircle2Icon,
  LayersIcon,
} from "lucide-react"
import { useDb, useDbClient } from "@zenbujs/core/react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { useActiveWorkspaceId } from "@/lib/window-state"
import type { Schema } from "../../../main/schema"

type Scope = Schema["scopes"][string]
type Repo = Schema["repos"][string]

type Bucket = "archived" | "completed"

/**
 * Bottom-of-sidebar entrypoint into the "shelved worktrees" buckets.
 * Renders nothing when the active workspace has no archived or
 * completed worktrees; the moment one shows up, an abstract
 * stacked-layers icon appears in the footer slot.
 *
 * UI shape: a single `DropdownMenu` whose root contains two
 * `DropdownMenuSub` entries \u2014 one for "Archived", one for
 * "Completed". Hovering a category opens a flyout sub-menu with
 * one row per worktree in that bucket; clicking a row toggles the
 * corresponding flag back to false (and clears the `archivedAt` /
 * `completedAt` stamp) so the worktree pops back into the regular
 * sidebar group list.
 *
 * The sub-menu (rather than the older "replace popover content"
 * design) is the right primitive here: Radix gives us hover
 * intent, keyboard arrow navigation, focus restoration, and
 * positioning for free, and it matches the standard "browse a
 * category, then act" interaction users already know from native
 * menus.
 */
export function WorktreeShelfMenu() {
  const activeWorkspaceId = useActiveWorkspaceId()
  const dbClient = useDbClient()
  const buttonRef = useRef<HTMLButtonElement>(null)

  // Subscribe to raw db slices. The selectors here MUST return
  // identities the db replica owns (not freshly-allocated arrays
  // of object literals) \u2014 `useDb` compares the returned value
  // across renders with shallow equality, so synthesizing a brand
  // new array of `{ id, label, \u2026 }` literals every selector run
  // would cause an infinite re-render loop.
  // (See zenbu-labs/zenbu.js#11.)
  const scopesById = useDb(root => root.app.scopes)
  const reposById = useDb(root => root.app.repos)

  type ShelfEntry = {
    id: string
    label: string
    archivedAt: number | null
    completedAt: number | null
    archived: boolean
    completed: boolean
  }

  const entries = useMemo<ShelfEntry[]>(() => {
    if (!activeWorkspaceId) return []
    const out: ShelfEntry[] = []
    for (const scope of Object.values(scopesById)) {
      if (scope.workspaceId !== activeWorkspaceId) continue
      if (!scope.archived && !scope.completed) continue
      const repoId = scope.repoId
      const repo: Repo | undefined = repoId
        ? reposById[repoId]
        : undefined
      out.push({
        id: scope.id,
        label: labelForScope(scope, repo ?? null),
        archivedAt: scope.archivedAt,
        completedAt: scope.completedAt,
        archived: scope.archived,
        completed: scope.completed,
      })
    }
    return out
  }, [activeWorkspaceId, scopesById, reposById])

  const archivedEntries = useMemo(
    () =>
      entries
        .filter(e => e.archived)
        // Most-recently-archived first so the freshest shelf is at
        // the top. Entries without a timestamp (legacy data
        // pre-migration) fall to the bottom but stay grouped by
        // id so the order is still deterministic.
        .sort(
          (a, b) =>
            (b.archivedAt ?? 0) - (a.archivedAt ?? 0) ||
            a.id.localeCompare(b.id),
        ),
    [entries],
  )
  const completedEntries = useMemo(
    () =>
      entries
        .filter(e => e.completed)
        .sort(
          (a, b) =>
            (b.completedAt ?? 0) - (a.completedAt ?? 0) ||
            a.id.localeCompare(b.id),
        ),
    [entries],
  )

  const unshelve = (scopeId: string, kind: Bucket) => {
    void dbClient.update(root => {
      const scope = root.app.scopes[scopeId]
      if (!scope) return
      if (kind === "archived") {
        scope.archived = false
        scope.archivedAt = null
      } else {
        scope.completed = false
        scope.completedAt = null
      }
    })
  }

  // Hide the whole control when there's nothing to show. An
  // always-on icon would be visually noisy on a fresh workspace.
  if (entries.length === 0) return null

  const totalCount = archivedEntries.length + completedEntries.length
  const triggerLabel = `Shelved worktrees (${totalCount})`

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          ref={buttonRef}
          type="button"
          variant="ghost"
          size="icon-xs"
          className="hg-icon size-[22px] rounded bg-transparent text-muted-foreground hover:bg-transparent"
          aria-label={triggerLabel}
          title={triggerLabel}
        >
          <LayersIcon size={13} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="top"
        sideOffset={6}
        className="w-56"
      >
        <BucketSub
          icon={<ArchiveIcon className="size-3.5" />}
          label="Archived"
          entries={archivedEntries}
          timestampOf={e => e.archivedAt}
          onPick={id => unshelve(id, "archived")}
        />
        <BucketSub
          icon={<CheckCircle2Icon className="size-3.5" />}
          label="Completed"
          entries={completedEntries}
          timestampOf={e => e.completedAt}
          onPick={id => unshelve(id, "completed")}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

type BucketSubProps = {
  icon: React.ReactNode
  label: string
  entries: ReadonlyArray<{
    id: string
    label: string
    archivedAt: number | null
    completedAt: number | null
  }>
  timestampOf: (e: {
    archivedAt: number | null
    completedAt: number | null
  }) => number | null
  onPick: (id: string) => void
}

/**
 * One category row in the root menu, with a hover-flyout
 * sub-menu listing every worktree in the bucket. Empty buckets
 * render a disabled trigger so the user can tell at a glance
 * which categories have anything in them.
 */
function BucketSub({
  icon,
  label,
  entries,
  timestampOf,
  onPick,
}: BucketSubProps) {
  const empty = entries.length === 0
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger disabled={empty}>
        <span className="text-muted-foreground">{icon}</span>
        <span className="flex-1">{label}</span>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {entries.length}
        </span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="max-h-[320px] w-64 overflow-y-auto">
        {entries.map(entry => {
          const ts = timestampOf(entry)
          const subtitle = ts != null ? formatRelative(ts) : null
          return (
            <DropdownMenuItem
              key={entry.id}
              onSelect={() => onPick(entry.id)}
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
      </DropdownMenuSubContent>
    </DropdownMenuSub>
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
 * since the sub-menu can render dozens of entries. */
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
