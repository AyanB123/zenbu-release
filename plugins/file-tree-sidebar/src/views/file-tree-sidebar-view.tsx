import { useEffect, useMemo, useRef } from "react";
import {
  useCollection,
  useDb,
  useRpc,
  type ViewComponentProps,
} from "@zenbujs/core/react";
import { FileTree, useFileTree } from "@pierre/trees/react";

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
 * Component-mode right-sidebar file tree.
 *
 * Reads the per-scope index from `root.app.fileTreeIndexes`
 * (owned by the host's `FileTreeService`). Click → file opens a
 * pane tab via `rpc.app.fileTree.openFile`, same as the legacy
 * iframe variant.
 *
 * Args are forwarded from the host shell as
 * `{ windowId, scopeId, directory }`. We prefer the explicit
 * `scopeId`/`directory` from args; if absent (e.g. caller-mounted
 * with no args) we fall back to walking `windowStates` ourselves.
 */
type FileTreeSidebarArgs = {
  windowId?: string | null;
  scopeId?: string | null;
  directory?: string | null;
};

export default function FileTreeSidebarView({
  args,
}: ViewComponentProps<FileTreeSidebarArgs>) {
  const active = useActiveScope(args);

  if (!active) {
    return (
      <div className="flex h-full items-center justify-center bg-background p-4 text-center text-[12px] text-muted-foreground">
        No active workspace.
      </div>
    );
  }

  return (
    <SidebarTreeForScope
      key={active.scopeId}
      scopeId={active.scopeId}
      directory={active.directory}
    />
  );
}

function SidebarTreeForScope({
  scopeId,
  directory,
}: {
  scopeId: string;
  directory: string;
}) {
  const index = useScopeIndex(scopeId);
  const paths = useScopePaths(scopeId);

  if (!index) return <Placeholder>Indexing…</Placeholder>;
  if (index.status === "error") {
    return (
      <Placeholder tone="error">
        {index.error ?? "Failed to index files."}
      </Placeholder>
    );
  }
  if (paths.length === 0) {
    if (index.status === "indexing")
      return <Placeholder>Indexing…</Placeholder>;
    return <Placeholder>No files in this scope.</Placeholder>;
  }
  return (
    <div className="relative h-full min-h-0 w-full bg-background text-foreground">
      <SidebarTree directory={directory} paths={paths} />
    </div>
  );
}

function SidebarTree({
  directory,
  paths,
}: {
  directory: string;
  paths: readonly string[];
}) {
  const rpc = useRpc();

  const openRef = useRef<(path: string) => void>(() => {});
  openRef.current = (path: string) => {
    void rpc.app.fileTree
      .openFile({ directory, path })
      .catch((err) =>
        console.error("[file-tree-sidebar] openFile failed:", err),
      );
  };

  const modelRef = useRef<ReturnType<typeof useFileTree>["model"] | null>(null);

  const { model } = useFileTree({
    paths,
    initialExpansion: 1,
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

function useActiveScope(
  args: FileTreeSidebarArgs | undefined,
): { scopeId: string; directory: string } | null {
  return useDb((root) => {
    const explicitId = args?.scopeId ?? null;
    if (explicitId) {
      const scope = root.app.scopes[explicitId];
      if (scope) return { scopeId: scope.id, directory: scope.directory };
    }
    const states = Object.values(root.app.windowStates);
    const scopeId =
      states.find((s) => s?.selectedScopeId != null)?.selectedScopeId ?? null;
    if (!scopeId) return null;
    const scope = root.app.scopes[scopeId];
    if (!scope) return null;
    return { scopeId: scope.id, directory: scope.directory };
  });
}

type ScopeIndexMeta = {
  status: "indexing" | "idle" | "error";
  error: string | null;
};

function useScopeIndex(scopeId: string): ScopeIndexMeta | null {
  return useDb((root) => {
    const index = root.app.fileTreeIndexes[scopeId];
    if (!index) return null;
    return { status: index.status, error: index.error };
  });
}

function useScopePaths(scopeId: string): readonly string[] {
  const pathsRef = useDb((root) => root.app.fileTreeIndexes[scopeId]?.paths);
  const { items } = useCollection(pathsRef);
  return useMemo(() => items.map((item) => item.path), [items]);
}
