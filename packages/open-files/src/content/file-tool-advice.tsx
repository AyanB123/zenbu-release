import { useMemo, type ComponentType, type MouseEvent } from "react";
import { useDb, useRpc } from "@zenbujs/core/react";

/**
 * Around-advice on the host's `ToolCall` chat-message component
 * (installed by `OpenFilesService.evaluate()` via `this.advise(...)`).
 *
 * Calling convention: zenbu's advice runtime calls around-advice as
 *   `aroundFn(next, ...originalArgs)`
 * where `next` is the original component (or the next around in the
 * chain). For a React component the original args are just the
 * props object, so the signature here is `(Original, props)`.
 *
 * Behavior:
 *  - Tool calls that aren't `read` / `edit` / `write`: forward to the
 *    original component untouched.
 *  - File-touching tool calls: forward to the original component but
 *    render it inside an outer wrapper that:
 *      * shows a pointer cursor on hover,
 *      * intercepts clicks (via `onClickCapture` so we run before any
 *        inner expand-toggle button) and calls
 *        `rpc.app.fileTree.openFile({ directory, path })`. That RPC
 *        emits `openFileInActivePane`, which the host shell already
 *        routes to a new pane next to the active one.
 *
 * Path resolution happens entirely in the renderer:
 *  - The tool input is normalized to an absolute file path (Pi's
 *    read/edit/write tools take absolute paths by convention; we
 *    fall back to `path` / `filePath` aliases for safety).
 *  - We pick the scope whose `directory` is the longest prefix of
 *    that absolute path, and compute the relative remainder. That
 *    matches the contract `FileTreeService.readFile` expects
 *    (`safeJoin(directory, path)`).
 *  - If no scope matches, we fall back to the active window's
 *    selected scope (best-effort), and ultimately bail out without
 *    firing the click so we never trigger a noisy
 *    `path escapes root` error.
 *
 * Click suppression caveats: `onClickCapture` runs before nested
 * `onClick` handlers, but React still dispatches to them afterwards
 * unless we stop propagation. We do — the inner cards (e.g. the
 * `EditCard` expand toggle) shouldn't fire when the user clearly
 * meant "open this file". A double-click to expand the diff trades
 * against a double-click to open the file twice, which is harmless
 * because the host's open-by-source reuses the same tab.
 */

// Mirror of the host's `ToolCallProps` shape. Duplicated here so
// this plugin doesn't reach into the host's source tree; the advice
// runtime hands us whatever the host's component receives.
type ToolCallShape = {
  toolCallId: string;
  title?: string;
  subtitle?: string;
  kind?: string;
  status?: "pending" | "running" | "completed" | "failed";
  toolName?: string;
  rawInput?: unknown;
  rawOutput?: unknown;
};

const FILE_TOOL_NAMES = new Set(["read", "edit", "write"]);
const FILE_TOOL_KINDS = new Set(["read", "edit", "create"]);

function isFileTool(props: ToolCallShape): boolean {
  const name = (props.toolName ?? "").toLowerCase();
  const kind = (props.kind ?? "").toLowerCase();
  return FILE_TOOL_NAMES.has(name) || FILE_TOOL_KINDS.has(kind);
}

/** Extract the file path the tool was pointed at. Matches the
 * alias set the host's `ReadCard` / `WriteCard` / `EditCard` use
 * (`file_path` || `path` || `filePath`). Returns `null` if the tool
 * payload doesn't look like a single-file action (e.g. multi-edit
 * tools that haven't shipped yet). */
function readToolFilePath(rawInput: unknown): string | null {
  if (!rawInput || typeof rawInput !== "object") return null;
  const input = rawInput as Record<string, unknown>;
  const candidate = input.file_path ?? input.path ?? input.filePath;
  if (typeof candidate !== "string" || candidate.length === 0) return null;
  // Strip any trailing `(L1-L2)` range tag the host appends to read
  // titles — only the actual path is meaningful to `safeJoin`.
  return candidate.replace(/\s*\([\d\s\-–,]+\)\s*$/, "");
}

/** Choose the scope whose `directory` is the longest prefix of
 * `absPath`. Falls back to the active window's selected scope so
 * relative-looking paths still have a reasonable home, and finally
 * to `null` when we have nothing to anchor on. */
function resolveOpen(
  absPath: string,
  scopes: { id: string; directory: string }[],
  activeScopeDirectory: string | null,
): { directory: string; path: string } | null {
  // Absolute path → find the best scope by prefix length.
  if (absPath.startsWith("/")) {
    let best: { directory: string; path: string } | null = null;
    for (const scope of scopes) {
      const dir = scope.directory.replace(/\/+$/, "");
      if (absPath === dir || absPath.startsWith(`${dir}/`)) {
        const rel = absPath === dir ? "" : absPath.slice(dir.length + 1);
        if (!best || dir.length > best.directory.length) {
          best = { directory: dir, path: rel };
        }
      }
    }
    if (best && best.path.length > 0) return best;
    return null;
  }
  // Already-relative path: anchor on the active scope if we have
  // one. The host's `safeJoin` will still reject ".." escapes.
  if (activeScopeDirectory) {
    return { directory: activeScopeDirectory, path: absPath };
  }
  return null;
}

// Fires once per advice module load so we can confirm the advice
// file evaluated in the renderer (vs. being silently dropped by
// the vite plugin / advice prelude).
console.log("[open-files-advice] module loaded");

export function FileToolAdvice(
  Original: ComponentType<ToolCallShape>,
  props: ToolCallShape,
) {
  if (!isFileTool(props)) {
    return <Original {...props} />;
  }
  return <FileToolWrapper Original={Original} props={props} />;
}

/** Hooks live in their own component so we don't call them for
 * non-file tool calls (rules-of-hooks). */
function FileToolWrapper({
  Original,
  props,
}: {
  Original: ComponentType<ToolCallShape>;
  props: ToolCallShape;
}) {
  const rpc = useRpc();
  // IMPORTANT: select stable references out of the replica.
  // Returning a fresh array/object from a `useDb` selector causes
  // useSyncExternalStore to see a new snapshot every render, which
  // triggers an infinite re-render loop. Derive arrays inside
  // `useMemo` instead.
  const scopesById = useDb(root => root.app.scopes);
  const windowStates = useDb(root => root.app.windowStates);

  const scopes = useMemo(
    () =>
      Object.values(scopesById).map(s => ({
        id: s.id,
        directory: s.directory,
      })),
    [scopesById],
  );

  const activeScopeDirectory = useMemo(() => {
    const states = Object.values(windowStates);
    const scopeId =
      states.find(s => s.selectedScopeId != null)?.selectedScopeId ?? null;
    if (!scopeId) return null;
    return scopesById[scopeId]?.directory ?? null;
  }, [windowStates, scopesById]);

  const target = useMemo(() => {
    const filePath = readToolFilePath(props.rawInput);
    if (!filePath) return null;
    return resolveOpen(filePath, scopes, activeScopeDirectory);
  }, [props.rawInput, scopes, activeScopeDirectory]);

  // No resolvable path → don't pretend the row is clickable.
  if (!target) {
    return <Original {...props} />;
  }

  const handleOpen = (e: MouseEvent<HTMLDivElement>) => {
    // Capture-phase + stopPropagation: inner expand-toggle buttons
    // would otherwise also fire on the same click. "Open file" is
    // the louder affordance here, so it wins.
    e.stopPropagation();
    void rpc.app.fileTree
      .openFile({ directory: target.directory, path: target.path })
      .catch(err =>
        console.error("[open-files-advice] openFile failed:", err),
      );
  };

  return (
    <div
      onClickCapture={handleOpen}
      style={{ cursor: "pointer" }}
      title={`Open ${target.path}`}
    >
      <Original {...props} />
    </div>
  );
}
