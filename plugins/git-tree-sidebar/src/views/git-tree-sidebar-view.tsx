import { useEffect, useMemo, useRef } from "react";
import { useDb, useRpc, type ViewComponentProps } from "@zenbujs/core/react";
import { FileTree, useFileTree } from "@pierre/trees/react";
import type { GitStatusEntry, GitStatus as TreeGitStatus } from "@pierre/trees";

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
} as React.CSSProperties;

/**
 * Override the `cursor: pointer` the library applies to tree rows
 * and the floating context-menu trigger. This is a desktop app —
 * we keep the system default arrow everywhere instead of switching
 * to the web's hand cursor on clickable affordances.
 *
 * `@pierre/trees` only exposes a fixed set of `--trees-*-override`
 * CSS variables (see its README “Styling” section) and doesn't
 * ship a cursor variable, so the documented escape hatch is
 * `unsafeCSS`, which the library injects into its shadow root.
 */
const DISABLE_POINTER_CSS = `
  [data-type='item'],
  [data-type='context-menu-trigger'] {
    cursor: default;
  }
`;

/**
 * Component-mode right-sidebar git tree. Shows only changed
 * paths in the active scope's working tree, with the standard
 * `@pierre/trees` git-status decorations.
 *
 * Args carry `{ windowId, scopeId, directory }` from the host
 * shell. We use them directly when present; otherwise fall back
 * to walking `windowStates` ourselves.
 *
 * Status data comes off the local replica
 * (`root.gitTreeSidebar.statuses[scopeId]`), populated on demand by
 * `GitStatusService.refresh`. The view calls refresh when the active
 * scope mounts or changes; no background polling.
 */
type GitTreeSidebarArgs = {
  windowId?: string | null;
  scopeId?: string | null;
  directory?: string | null;
};

export default function GitTreeSidebarView({
  args,
}: ViewComponentProps<GitTreeSidebarArgs>) {
  const active = useActiveScope(args);

  if (!active) {
    return <Placeholder>No active workspace.</Placeholder>;
  }

  return (
    <SidebarTreeForScope
      key={active.scopeId}
      workspaceId={active.workspaceId}
      scopeId={active.scopeId}
      directory={active.directory}
    />
  );
}

/* ------------------------ local status types ------------------------ */

// Structural mirror of the plugin's own DB slot (written by
// `GitStatusService`). Restated here so the view stays decoupled
// from the schema file's exports — the shape is small enough
// that drift is easy to spot.
type GitFileStatus = { path: string; code: string; untracked: boolean };
type ScopeStatus = {
  isRepo: boolean;
  files: GitFileStatus[];
  status: "polling" | "idle" | "error";
  error: string | null;
  updatedAt: number;
};

function SidebarTreeForScope({
  workspaceId,
  scopeId,
  directory,
}: {
  workspaceId: string;
  scopeId: string;
  directory: string;
}) {
  const rpc = useRpc();
  const status = useScopeStatus(scopeId);

  useEffect(() => {
    void rpc.gitTreeSidebar.gitStatus
      .refresh({ scopeId })
      .catch((err) => console.error("[git-tree-sidebar] refresh failed:", err));
  }, [rpc, scopeId]);

  if (!status) {
    return <Placeholder>Loading…</Placeholder>;
  }
  if (status.status === "error" && status.updatedAt === 0) {
    return (
      <Placeholder tone="error">
        {status.error ?? "Failed to read git status."}
      </Placeholder>
    );
  }
  if (!status.isRepo) {
    return <Placeholder>Not a git repository.</Placeholder>;
  }
  if (status.files.length === 0) {
    return <Placeholder>No changes on this branch.</Placeholder>;
  }

  return (
    <div className="relative h-full min-h-0 w-full bg-background text-foreground">
      <SidebarTree
        workspaceId={workspaceId}
        scopeId={scopeId}
        directory={directory}
        files={status.files}
      />
    </div>
  );
}

function SidebarTree({
  workspaceId,
  scopeId,
  directory,
  files,
}: {
  workspaceId: string;
  scopeId: string;
  directory: string;
  files: readonly GitFileStatus[];
}) {
  const rpc = useRpc();

  const { paths, gitStatus } = useMemo(() => {
    const seen = new Set<string>();
    const paths: string[] = [];
    const gitStatus: GitStatusEntry[] = [];
    for (const f of files) {
      if (seen.has(f.path)) continue;
      seen.add(f.path);
      paths.push(f.path);
      gitStatus.push({ path: f.path, status: mapGitStatus(f) });
    }
    paths.sort();
    return { paths, gitStatus };
  }, [files]);

  const openRef = useRef<(path: string) => void>(() => {});
  openRef.current = (path: string) => {
    void rpc.app.gitTree
      .openDiff({ workspaceId, scopeId, directory, path })
      .catch((err) =>
        console.error("[git-tree-sidebar] openDiff failed:", err),
      );
  };

  const modelRef = useRef<ReturnType<typeof useFileTree>["model"] | null>(null);

  const { model } = useFileTree({
    paths,
    gitStatus,
    initialExpansion: "open",
    flattenEmptyDirectories: true,
    search: true,
    density: "compact",
    initialVisibleRowCount: 60,
    unsafeCSS: DISABLE_POINTER_CSS,
    onSelectionChange: (selected) => {
      const first = selected[0];
      if (!first) return;
      const handle = modelRef.current?.getItem(first);
      if (handle && !handle.isDirectory()) {
        openRef.current(first);
      }
    },
  });
  modelRef.current = model;

  const lastPathsRef = useRef(paths);
  useEffect(() => {
    const prev = lastPathsRef.current;
    if (prev === paths) return;
    lastPathsRef.current = paths;
    const prevSet = new Set(prev);
    const nextSet = new Set(paths);
    const ops: { type: "add" | "remove"; path: string }[] = [];
    for (const p of paths)
      if (!prevSet.has(p)) ops.push({ type: "add", path: p });
    for (const p of prev)
      if (!nextSet.has(p)) ops.push({ type: "remove", path: p });
    if (ops.length === 0) return;
    model.batch(ops);
  }, [model, paths]);

  return (
    <div className="absolute inset-0">
      <FileTree model={model} style={TREE_STYLE} />
    </div>
  );
}

/* -------------------------------- helpers ------------------------------- */

function Placeholder({
  children,
  tone = "muted",
}: {
  children: React.ReactNode;
  tone?: "muted" | "error";
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
  );
}

function mapGitStatus(file: GitFileStatus): TreeGitStatus {
  if (file.untracked) return "untracked";
  const code = file.code;
  if (code.includes("A")) return "added";
  if (code.includes("D")) return "deleted";
  if (code.includes("R")) return "renamed";
  if (code.includes("M")) return "modified";
  return "modified";
}

function useActiveScope(
  args: GitTreeSidebarArgs | undefined,
): { workspaceId: string; scopeId: string; directory: string } | null {
  return useDb((root) => {
    const explicitId = args?.scopeId ?? null;
    if (explicitId) {
      const scope = root.app.scopes[explicitId];
      if (scope) {
        return {
          workspaceId: scope.workspaceId,
          scopeId: scope.id,
          directory: scope.directory,
        };
      }
    }
    const states = Object.values(root.app.windowStates);
    const scopeId =
      states.find((s) => s?.selectedScopeId != null)?.selectedScopeId ?? null;
    if (!scopeId) return null;
    const scope = root.app.scopes[scopeId];
    if (!scope) return null;
    return {
      workspaceId: scope.workspaceId,
      scopeId: scope.id,
      directory: scope.directory,
    };
  });
}

/** Read the plugin-owned status cache for `scopeId`. Refreshed on
 * demand via `rpc.gitTreeSidebar.gitStatus.refresh`. */
function useScopeStatus(scopeId: string): ScopeStatus | null {
  return useDb(
    (root) =>
      (root.gitTreeSidebar.statuses[scopeId] as ScopeStatus | undefined) ??
      null,
  );
}
