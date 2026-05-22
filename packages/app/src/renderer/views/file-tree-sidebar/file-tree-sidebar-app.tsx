import { useEffect, useRef } from "react"
import { useDb, useRpc } from "@zenbujs/core/react"
import { FileTree, useFileTree } from "@pierre/trees/react"
import { useThemeSync } from "@/lib/theme"
import type { Schema } from "../../../main/schema"

const TREE_STYLE: React.CSSProperties = {
  "--trees-bg-override": "var(--background)",
  "--trees-bg-muted-override": "var(--background)",
  "--trees-fg-override": "var(--foreground)",
  "--trees-fg-muted-override": "var(--muted-foreground)",
  "--trees-accent-override": "var(--accent)",
  "--trees-selected-bg-override": "var(--accent)",
  "--trees-selected-fg-override": "var(--accent-foreground)",
  "--trees-selected-focused-border-color-override": "var(--ring)",
  "--trees-focus-ring-color-override": "var(--ring)",
  "--trees-indent-guide-bg-override": "var(--border)",
  "--trees-border-color-override": "var(--border)",
  "--trees-input-bg-override": "var(--background)",
  "--trees-scrollbar-thumb-override": "var(--muted-foreground)",
  "--trees-font-family-override": "var(--font-sans)",
  "--trees-font-size-override": "12px",
  "--trees-border-radius-override": "4px",
  position: "absolute",
  inset: 0,
} as React.CSSProperties

/**
 * Sidebar-only file tree. Same data source as the inline file-tree
 * pane view (reads `root.app.fileTreeIndexes` directly), but the only
 * affordance is: click a file → `fileTree.openFile`, which fires an
 * event the main shell uses to add a new pane tab.
 */
export function FileTreeSidebarApp() {
  useThemeSync()
  const active = useActiveScope()

  if (!active) {
    return (
      <div className="flex h-full items-center justify-center bg-background p-4 text-center text-[12px] text-muted-foreground">
        No active workspace.
      </div>
    )
  }

  return (
    <SidebarTreeForScope
      key={active.scopeId}
      scopeId={active.scopeId}
      directory={active.directory}
    />
  )
}

function SidebarTreeForScope({
  scopeId,
  directory,
}: {
  scopeId: string
  directory: string
}) {
  const index = useScopeIndex(scopeId)

  if (!index) return <Placeholder>Indexing…</Placeholder>
  if (index.status === "error") {
    return <Placeholder tone="error">{index.error ?? "Failed to index files."}</Placeholder>
  }
  if (index.paths.length === 0) {
    if (index.status === "indexing") return <Placeholder>Indexing…</Placeholder>
    return <Placeholder>No files in this scope.</Placeholder>
  }
  return (
    <div className="relative h-full min-h-0 w-full bg-background text-foreground">
      <SidebarTree directory={directory} paths={index.paths} />
    </div>
  )
}

function SidebarTree({
  directory,
  paths,
}: {
  directory: string
  paths: readonly string[]
}) {
  const rpc = useRpc()

  // Stable ref so the onSelectionChange callback never goes stale; the
  // tree model is built once per mount and we don't want to recreate
  // it as `directory`/`rpc` identities change.
  const openRef = useRef<(path: string) => void>(() => {})
  openRef.current = (path: string) => {
    void rpc.app.fileTree
      .openFile({ directory, path })
      .catch(err =>
        console.error("[file-tree-sidebar] openFile failed:", err),
      )
  }

  const modelRef = useRef<ReturnType<typeof useFileTree>["model"] | null>(null)

  const { model } = useFileTree({
    paths,
    initialExpansion: 1,
    flattenEmptyDirectories: true,
    search: true,
    density: "compact",
    initialVisibleRowCount: 60,
    onSelectionChange: selected => {
      const first = selected[0]
      if (!first) return
      const handle = modelRef.current?.getItem(first)
      if (handle && !handle.isDirectory()) {
        openRef.current(first)
      }
    },
  })
  modelRef.current = model

  // Diff path set on re-index so expansion/selection state survives.
  const lastPathsRef = useRef(paths)
  useEffect(() => {
    const prev = lastPathsRef.current
    if (prev === paths) return
    lastPathsRef.current = paths
    const prevSet = new Set(prev)
    const nextSet = new Set(paths)
    const ops: { type: "add" | "remove"; path: string }[] = []
    for (const p of paths) if (!prevSet.has(p)) ops.push({ type: "add", path: p })
    for (const p of prev) if (!nextSet.has(p)) ops.push({ type: "remove", path: p })
    if (ops.length === 0) return
    model.batch(ops)
  }, [model, paths])

  return (
    <div className="absolute inset-0">
      <FileTree model={model} style={TREE_STYLE} />
    </div>
  )
}

function Placeholder({
  children,
  tone = "muted",
}: {
  children: React.ReactNode
  tone?: "muted" | "error"
}) {
  return (
    <div
      className={
        "flex h-full items-center justify-center p-4 text-center text-[12px] " +
        (tone === "error" ? "text-destructive" : "text-muted-foreground")
      }
    >
      {children}
    </div>
  )
}

function useActiveScope(): { scopeId: string; directory: string } | null {
  return useDb(root => {
    const states = Object.values(root.app.windowStates)
    const scopeId =
      states.find(s => s.selectedScopeId != null)?.selectedScopeId ?? null
    if (!scopeId) return null
    const scope = root.app.scopes[scopeId]
    if (!scope) return null
    return { scopeId: scope.id, directory: scope.directory }
  })
}

function useScopeIndex(scopeId: string): Schema["fileTreeIndexes"][string] | null {
  return useDb(root => root.app.fileTreeIndexes[scopeId] ?? null)
}
