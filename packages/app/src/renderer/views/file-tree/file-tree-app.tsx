import { useEffect, useRef, useState } from "react"
import { Allotment } from "allotment"
import { useDb } from "@zenbujs/core/react"
import { FileTree, useFileTree } from "@pierre/trees/react"
import { useThemeSync } from "@/lib/theme"
import { FilePreview } from "./file-preview"
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

export function FileTreeApp() {
  useThemeSync()
  const active = useActiveScope()

  if (!active) {
    return (
      <div className="flex h-full items-center justify-center bg-background p-4 text-center text-[12px] text-muted-foreground">
        No active workspace. Pick one in the sidebar to browse its files.
      </div>
    )
  }

  return (
    <FileTreePane
      key={active.scopeId}
      scopeId={active.scopeId}
      directory={active.directory}
    />
  )
}

function FileTreePane({
  scopeId,
  directory,
}: {
  scopeId: string
  directory: string
}) {
  const index = useScopeIndex(scopeId)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)

  const tree = (
    <div className="relative h-full min-h-0 min-w-0">
      <TreeOrPlaceholder
        index={index}
        selectedPath={selectedPath}
        onSelect={setSelectedPath}
      />
    </div>
  )

  return (
    <div className="relative h-full min-h-0 w-full bg-background text-foreground">
      {selectedPath ? (
        <Allotment>
          <Allotment.Pane minSize={160}>
            <div className="relative h-full min-h-0 min-w-0">
              <FilePreview
                key={`${directory}::${selectedPath}`}
                directory={directory}
                path={selectedPath}
              />
            </div>
          </Allotment.Pane>
          <Allotment.Pane minSize={140} preferredSize={260}>
            {tree}
          </Allotment.Pane>
        </Allotment>
      ) : (
        tree
      )}
    </div>
  )
}

function TreeOrPlaceholder({
  index,
  selectedPath,
  onSelect,
}: {
  index: Schema["fileTreeIndexes"][string] | null
  selectedPath: string | null
  onSelect: (p: string | null) => void
}) {
  if (!index) return <Placeholder>Indexing…</Placeholder>
  if (index.status === "error") {
    return (
      <Placeholder tone="error">
        {index.error ?? "Failed to index files."}
      </Placeholder>
    )
  }
  if (index.paths.length === 0) {
    if (index.status === "indexing") return <Placeholder>Indexing…</Placeholder>
    return <Placeholder>No files in this scope.</Placeholder>
  }
  return (
    <TreePane
      paths={index.paths}
      selectedPath={selectedPath}
      onSelect={onSelect}
    />
  )
}

function TreePane({
  paths,
  selectedPath,
  onSelect,
}: {
  paths: readonly string[]
  selectedPath: string | null
  onSelect: (p: string | null) => void
}) {
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect

  const initialSelectedRef = useRef(selectedPath ? [selectedPath] : undefined)
  const initialSelected = initialSelectedRef.current

  const modelRef = useRef<ReturnType<typeof useFileTree>["model"] | null>(null)

  const { model } = useFileTree({
    paths,
    initialExpansion: 1,
    flattenEmptyDirectories: true,
    search: true,
    density: "compact",
    initialVisibleRowCount: 60,
    initialSelectedPaths: initialSelected,
    onSelectionChange: selected => {
      const first = selected[0] ?? null
      if (!first) {
        onSelectRef.current(null)
        return
      }
      const handle = modelRef.current?.getItem(first)
      if (handle && !handle.isDirectory()) {
        onSelectRef.current(first)
      }
    },
  })
  modelRef.current = model

  const lastPathsRef = useRef(paths)
  useEffect(() => {
    const prev = lastPathsRef.current
    if (prev === paths) return
    lastPathsRef.current = paths

    // Diff the path set and apply incremental add/remove operations so the
    // tree's expansion/selection state survives re-indexes. `resetPaths` is
    // a whole-tree reset and would collapse anything the user just opened.
    const prevSet = new Set(prev)
    const nextSet = new Set(paths)
    const ops: { type: "add" | "remove"; path: string }[] = []
    for (const p of paths) {
      if (!prevSet.has(p)) ops.push({ type: "add", path: p })
    }
    for (const p of prev) {
      if (!nextSet.has(p)) ops.push({ type: "remove", path: p })
    }
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
