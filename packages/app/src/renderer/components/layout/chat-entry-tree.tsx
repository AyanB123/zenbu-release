import { useEffect, useMemo, useState } from "react"
import { useRpc } from "@zenbujs/core/react"
import { cn } from "@/lib/utils"

export type EntryNode = {
  id: string
  parentId: string | null
  kind: string
  label: string
  timestamp: number
}

export type ChatEntryTreeProps = {
  sessionId: string
  /** Re-fetch when this changes (e.g. session.lastActivityAt). */
  refreshKey: number
  /** Currently active leaf entry id; row gets highlighted. */
  activeLeafId: string | null
  /** Receives both the entry id and its display label so the caller
   * can show a preview (e.g. in the branch-summary dialog) without
   * round-tripping to rebuild the tree. */
  onSelect: (entryId: string, label: string) => void
  onContextMenu: (entryId: string, label: string, e: React.MouseEvent) => void
  /** Indent depth in px applied to the deepest node label. */
  baseIndent?: number
}

type TreeNode = EntryNode & { depth: number; children: TreeNode[] }

export function ChatEntryTree({
  sessionId,
  refreshKey,
  activeLeafId,
  onSelect,
  onContextMenu,
  baseIndent = 16,
}: ChatEntryTreeProps) {
  const rpc = useRpc()
  const [entries, setEntries] = useState<EntryNode[]>([])
  const [leafId, setLeafId] = useState<string | null>(null)
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
        setLeafId(result.leafId)
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

  const branches = useMemo(() => buildBranchTree(entries), [entries])
  const highlightId = activeLeafId ?? leafId

  if (loading && entries.length === 0) {
    return (
      <div className="px-3 py-2 text-[11px] text-muted-foreground">Loading…</div>
    )
  }
  if (error) {
    return (
      <div className="px-3 py-2 text-[11px] text-destructive">{error}</div>
    )
  }
  if (branches.length === 0) {
    return (
      <div className="px-3 py-2 text-[11px] text-muted-foreground">
        No branches yet.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-px">
      {branches.map(node => {
        const isActive = node.id === highlightId
        return (
          <button
            key={node.id}
            type="button"
            onClick={() => onSelect(node.id, node.label)}
            onContextMenu={e => {
              e.preventDefault()
              onContextMenu(node.id, node.label, e)
            }}
            className={cn(
              "flex min-h-[24px] items-center gap-1 rounded px-2 text-left text-[11px] text-sidebar-foreground hover:bg-accent hover:text-accent-foreground",
              isActive &&
                "bg-sidebar-accent text-sidebar-accent-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            )}
            style={{ paddingLeft: 8 + node.depth * baseIndent }}
          >
            <NodeGlyph kind={node.nodeKind} />
            <span className="flex-1 truncate">{node.label}</span>
          </button>
        )
      })}
    </div>
  )
}

type BranchNode = EntryNode & {
  depth: number
  nodeKind: "leaf" | "branch"
}

const BORING_KINDS = new Set([
  "model_change",
  "thinking_level_change",
  "session_info",
  "label",
])

function buildBranchTree(entries: EntryNode[]): BranchNode[] {
  if (entries.length === 0) return []

  const byId = new Map(entries.map(e => [e.id, e] as const))
  const reparented = entries
    .filter(e => !BORING_KINDS.has(e.kind))
    .map(e => ({ ...e, parentId: resolveParent(e.parentId, byId) }))

  const childrenOf = new Map<string | null, EntryNode[]>()
  for (const e of reparented) {
    const list = childrenOf.get(e.parentId) ?? []
    list.push(e)
    childrenOf.set(e.parentId, list)
  }
  for (const list of childrenOf.values()) {
    list.sort((a, b) => a.timestamp - b.timestamp)
  }

  const out: BranchNode[] = []
  const walk = (siblings: EntryNode[], depth: number) => {
    for (const start of siblings) {
      let cur = start
      while (true) {
        const kids = childrenOf.get(cur.id) ?? []
        if (kids.length === 1) {
          cur = kids[0]
          continue
        }
        break
      }
      const kids = childrenOf.get(cur.id) ?? []
      if (kids.length === 0) {
        out.push({ ...cur, depth, nodeKind: "leaf" })
      } else {
        out.push({ ...cur, depth, nodeKind: "branch" })
        walk(kids, depth + 1)
      }
    }
  }
  walk(childrenOf.get(null) ?? [], 0)
  return out
}

function resolveParent(
  parentId: string | null,
  byId: Map<string, EntryNode>,
): string | null {
  let p = parentId
  while (p) {
    const ent = byId.get(p)
    if (!ent) return null
    if (!BORING_KINDS.has(ent.kind)) return p
    p = ent.parentId
  }
  return null
}

function NodeGlyph({ kind }: { kind: "leaf" | "branch" }) {
  return (
    <span className="inline-flex w-3 shrink-0 justify-center text-[10px] text-muted-foreground">
      {kind === "branch" ? "◉" : "○"}
    </span>
  )
}
