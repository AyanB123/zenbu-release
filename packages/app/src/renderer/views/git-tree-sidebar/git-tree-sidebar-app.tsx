import { useEffect, useMemo, useRef, useState } from "react"
import { useDb, useRpc } from "@zenbujs/core/react"
import { FileTree, useFileTree } from "@pierre/trees/react"
import type { GitStatusEntry, GitStatus as TreeGitStatus } from "@pierre/trees"
import { useThemeSync } from "@/lib/theme"
import type { GitFileStatus, GitStatus } from "@/views/pr/types"

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

/** How often to re-poll `pr.getStatus`. Same cadence the full Git
 * view uses for its background refresh. */
const POLL_MS = 2500

/**
 * Sidebar tree of only the *changed* files in the active scope's git
 * working tree. Each row gets the standard `@pierre/trees` git status
 * decoration (M / A / D / R / ?) via the library's built-in
 * `gitStatus` prop. Clicking a file calls `rpc.app.gitTree.openDiff`
 * which fires an event the main shell catches to open the `git-diff`
 * embed view in a new split pane — same pattern as the file-tree
 * sidebar, but pointed at diffs instead of file previews.
 */
export function GitTreeSidebarApp() {
  useThemeSync()
  const active = useActiveScope()

  if (!active) {
    return (
      <Placeholder>
        No active workspace.
      </Placeholder>
    )
  }

  return (
    <SidebarTreeForScope
      key={active.scopeId}
      directory={active.directory}
    />
  )
}

function SidebarTreeForScope({ directory }: { directory: string }) {
  const status = usePolledStatus(directory)

  if (status == null) {
    return <Placeholder>Loading…</Placeholder>
  }
  if (!status.isRepo) {
    return <Placeholder>Not a git repository.</Placeholder>
  }
  if (status.files.length === 0) {
    return (
      <Placeholder>
        Working tree is clean.
        <br />
        <span className="font-mono opacity-60">{directory}</span>
      </Placeholder>
    )
  }

  return (
    <div className="relative h-full min-h-0 w-full bg-background text-foreground">
      <SidebarTree directory={directory} files={status.files} />
    </div>
  )
}

function SidebarTree({
  directory,
  files,
}: {
  directory: string
  files: readonly GitFileStatus[]
}) {
  const rpc = useRpc()

  // Stable list of paths + parallel git status decoration array.
  const { paths, gitStatus } = useMemo(() => {
    const seen = new Set<string>()
    const paths: string[] = []
    const gitStatus: GitStatusEntry[] = []
    for (const f of files) {
      if (seen.has(f.path)) continue
      seen.add(f.path)
      paths.push(f.path)
      gitStatus.push({ path: f.path, status: mapGitStatus(f) })
    }
    paths.sort()
    return { paths, gitStatus }
  }, [files])

  // Stable ref so the onSelectionChange callback never goes stale.
  const openRef = useRef<(path: string) => void>(() => {})
  openRef.current = (path: string) => {
    void rpc.app.gitTree
      .openDiff({ directory, path })
      .catch(err =>
        console.error("[git-tree-sidebar] openDiff failed:", err),
      )
  }

  const modelRef = useRef<ReturnType<typeof useFileTree>["model"] | null>(null)

  const { model } = useFileTree({
    paths,
    gitStatus,
    initialExpansion: "open",
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

  // Diff the path set across status refreshes so expansion / focus
  // state survives. Same trick the file-tree sidebar uses.
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

/* -------------------------------- helpers ------------------------------- */

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

/** Translate our XY porcelain code into the `@pierre/trees` enum the
 * library uses for its built-in M / A / D / R / ? decorations. We
 * prefer the worktree side over the index side because the sidebar's
 * job is to show *what's different on disk*; the priority order
 * (added > deleted > renamed > modified) matches what the porcelain
 * does for combined statuses like "AM" or "RM". */
function mapGitStatus(file: GitFileStatus): TreeGitStatus {
  if (file.untracked) return "untracked"
  const code = file.code
  if (code.includes("A")) return "added"
  if (code.includes("D")) return "deleted"
  if (code.includes("R")) return "renamed"
  if (code.includes("M")) return "modified"
  // Copy / type-change etc — show as modified so the file still gets
  // a visible badge.
  return "modified"
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

/** Poll `pr.getStatus` on a fixed interval. There's no DB-backed
 * status mirror yet (the full Git view also polls), so we do the
 * same thing here. */
function usePolledStatus(directory: string): GitStatus | null {
  const rpc = useRpc()
  const [status, setStatus] = useState<GitStatus | null>(null)

  useEffect(() => {
    let cancelled = false
    const tick = async () => {
      try {
        const next = await rpc.app.pr.getStatus({ directory })
        if (!cancelled) setStatus(next)
      } catch {
        // Errors are surfaced through the full Git view; the sidebar
        // just keeps showing the last good snapshot.
      }
    }
    void tick()
    const id = setInterval(() => void tick(), POLL_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [directory, rpc])

  return status
}
