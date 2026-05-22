import { useEffect, useMemo, useState } from "react"
import { useDb, useRpc } from "@zenbujs/core/react"
import { cn } from "@/lib/utils"
import { useActiveChatId } from "@/lib/window-state"

type EntryNode = {
  id: string
  parentId: string | null
  kind: string
  label: string
  timestamp: number
}

type TreeNode = EntryNode & { children: TreeNode[] }

type FlatRow = {
  node: TreeNode
  /** Indent level. Depth 0 is the trunk; each fork bumps the alt
   * children's depth by one. */
  depth: number
  /** True iff this is the first row of a *non-primary* fork child,
   * i.e. the place that visually "branches off" from the spine.
   * Renderer draws the `└─` connector here. */
  isBranchStart: boolean
  /** True iff this row sits on the path root → activeLeafId. Purely
   * a visual hint; ordering is independent. */
  isOnPath: boolean
}

export type PiSessionsTreeSidebarProps = {
  /** Click handler for an entry row. Lifted so the host can open a
   * shared "Summarize branch?" dialog instead of every tree variant
   * shipping its own. Omit to make rows read-only. */
  onEntrySelect?: (sessionId: string, entryId: string, label: string) => void
}

/**
 * git-log style tree of every entry in the active chat's pi session.
 *
 * Layout rules — chosen to match how pi's CLI shows the same data,
 * and chosen to be stable under leaf moves so clicking a node never
 * reflows the list (it just moves a highlight):
 *
 *   1. Children at every node are sorted by creation timestamp
 *      oldest-first, then never reordered. The "primary" of a fork
 *      is the FIRST child (oldest); it continues inline at the
 *      same depth. Newer siblings are "alt branches", rendered at
 *      depth+1 below the primary with a `└` connector marking the
 *      branch-off point. Layout is independent of `activeLeafId`,
 *      so clicking just moves the highlight.
 *   2. Current-leaf path is highlighted visually only. The leaf
 *      pointer moves; rows do not.
 *   3. No per-row glyph. Label text already tells you what the
 *      entry is; an always-present bullet/icon is just visual noise.
 *      The branch-off `└` is the only character we draw — it
 *      carries actual structural information.
 *   4. Linear chains stay at one depth, so long single-thread
 *      conversations don't pile up into a deep ladder.
 *   5. No collapse / expand affordances. Every entry is always
 *      visible. The tree is small enough (turns are minutes apart)
 *      and the alt branches are the whole point of having a tree
 *      view — hiding them defeats the purpose.
 *
 * Hacky: fetches via RPC on mount + whenever the active session's
 * `lastActivityAt` changes.
 */
export function PiSessionsTreeSidebar({
  onEntrySelect,
}: PiSessionsTreeSidebarProps = {}) {
  const activeChatId = useActiveChatId()
  const sessionId = useDb(root => {
    if (!activeChatId) return null
    const chat = root.app.chats[activeChatId]
    if (!chat || chat.session.kind !== "ready") return null
    return chat.session.sessionId
  })
  const refreshKey = useDb(root => {
    if (!sessionId) return 0
    return root.app.sessions[sessionId]?.lastActivityAt ?? 0
  })
  const activeLeafId = useDb(root => {
    if (!sessionId) return null
    return root.app.sessions[sessionId]?.currentLeafEntryId ?? null
  })

  if (!sessionId) {
    return (
      <div className="px-3 py-6 text-center text-[11px] text-muted-foreground">
        No active chat.
      </div>
    )
  }

  return (
    <PiSessionsTreeBody
      sessionId={sessionId}
      refreshKey={refreshKey}
      activeLeafId={activeLeafId}
      onEntrySelect={onEntrySelect}
    />
  )
}

function PiSessionsTreeBody({
  sessionId,
  refreshKey,
  activeLeafId,
  onEntrySelect,
}: {
  sessionId: string
  refreshKey: number
  activeLeafId: string | null
  onEntrySelect?: (sessionId: string, entryId: string, label: string) => void
}) {
  const rpc = useRpc()
  const [entries, setEntries] = useState<EntryNode[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    rpc.app.sessions
      .getEntryTree({ sessionId })
      .then(result => {
        if (cancelled) return
        setEntries(result.entries)
        setError(null)
        setLoading(false)
      })
      .catch(err => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [rpc, sessionId, refreshKey])

  // Tree shape: stable, derived only from entries — NOT from the
  // active leaf. Reordering on leaf-move is what caused the layout
  // shift the user complained about.
  const roots = useMemo(() => buildTree(entries), [entries])

  // Path root → activeLeaf. Used for visual highlight only; flat
  // layout is independent.
  const currentPath = useMemo(() => {
    const set = new Set<string>()
    if (!activeLeafId) return set
    const byId = new Map(entries.map(e => [e.id, e] as const))
    let cur: string | null = activeLeafId
    while (cur && !set.has(cur)) {
      set.add(cur)
      cur = byId.get(cur)?.parentId ?? null
    }
    return set
  }, [entries, activeLeafId])

  const flat = useMemo(
    () => flatten(roots, currentPath),
    [roots, currentPath],
  )

  if (loading && entries.length === 0) {
    return (
      <div className="px-3 py-2 text-[11px] text-muted-foreground">
        Loading…
      </div>
    )
  }
  if (error) {
    return (
      <div className="px-3 py-2 text-[11px] text-destructive">{error}</div>
    )
  }
  if (flat.length === 0) {
    return (
      <div className="px-3 py-6 text-center text-[11px] text-muted-foreground">
        No entries yet.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-px py-1 select-none">
      {flat.map(row => (
        <TreeRow
          key={row.node.id}
          row={row}
          isActive={row.node.id === activeLeafId}
          onClick={
            onEntrySelect && row.node.id !== activeLeafId
              ? () =>
                  onEntrySelect(sessionId, row.node.id, row.node.label)
              : undefined
          }
        />
      ))}
    </div>
  )
}

function TreeRow({
  row,
  isActive,
  onClick,
}: {
  row: FlatRow
  isActive: boolean
  onClick?: () => void
}) {
  const { node, depth, isBranchStart, isOnPath } = row
  const clickable = !!onClick
  return (
    <div
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? onClick : undefined}
      onKeyDown={
        clickable
          ? e => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault()
                onClick!()
              }
            }
          : undefined
      }
      className={cn(
        "group relative flex min-h-[20px] items-center gap-1 pr-1 text-[11px] leading-[1.3]",
        "hover:bg-accent hover:text-accent-foreground",
        isOnPath ? "text-sidebar-foreground" : "text-muted-foreground/60",
        isActive &&
          "bg-sidebar-accent text-sidebar-accent-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        clickable && "cursor-pointer",
      )}
      style={{ paddingLeft: 2 + depth * 10 }}
    >
      {/* Gutter cell: `└` connector when this row starts an alt
       * branch (the only character we draw that carries structural
       * info). Empty otherwise; no bullet, no chevron. Fixed width
       * so labels at the same depth still line up. */}
      <span
        aria-hidden
        className="inline-flex h-3 w-3 shrink-0 items-center justify-center text-[10px] text-muted-foreground"
      >
        {isBranchStart ? "└" : null}
      </span>
      <span className="flex-1 truncate" aria-label={`${node.kind}: ${node.label}`}>
        {node.label}
      </span>
    </div>
  )
}

/**
 * Build the parent/child tree. Children at every node are sorted
 * by creation timestamp ascending (oldest first). Primary = first
 * child; alts = the rest. Sorting is independent of
 * `activeLeafId`, so the visible layout doesn't shift when the
 * user just navigates around.
 */
function buildTree(entries: EntryNode[]): TreeNode[] {
  const byId = new Map<string, TreeNode>()
  for (const e of entries) {
    byId.set(e.id, { ...e, children: [] })
  }
  const roots: TreeNode[] = []
  for (const node of byId.values()) {
    if (node.parentId && byId.has(node.parentId)) {
      byId.get(node.parentId)!.children.push(node)
    } else {
      roots.push(node)
    }
  }
  const sortRec = (n: TreeNode) => {
    n.children.sort((a, b) => a.timestamp - b.timestamp)
    for (const c of n.children) sortRec(c)
  }
  roots.sort((a, b) => a.timestamp - b.timestamp)
  for (const r of roots) sortRec(r)
  return roots
}

/**
 * Walk the tree producing a flat row list. Algorithm:
 *
 *   - At every fork, the FIRST child (oldest) is the "primary" and
 *     continues inline at the same depth as the fork.
 *   - All other children are "alt branches"; each starts a new
 *     branch rendered at depth+1, with `isBranchStart=true` on its
 *     root row so the renderer can draw the `└` connector.
 *   - Linear chains stay at one depth.
 *   - Collapsing a fork hides its alt branches only — the primary
 *     stays visible because it's the natural continuation of the
 *     trunk.
 */
function flatten(
  roots: TreeNode[],
  currentPath: Set<string>,
): FlatRow[] {
  const out: FlatRow[] = []
  const walk = (node: TreeNode, depth: number, isBranchStart: boolean) => {
    out.push({
      node,
      depth,
      isBranchStart,
      isOnPath: currentPath.has(node.id),
    })
    if (node.children.length === 0) return
    if (node.children.length === 1) {
      walk(node.children[0], depth, false)
      return
    }
    // Fork: primary (oldest child) inline, newer siblings as alt
    // branches at depth+1 below.
    const [primary, ...alts] = node.children
    walk(primary, depth, false)
    for (const alt of alts) {
      walk(alt, depth + 1, true)
    }
  }
  for (const r of roots) walk(r, 0, false)
  return out
}
