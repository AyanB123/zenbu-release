import { useMemo } from "react"
import {
  useDb,
  useDbClient,
  useInjections,
  useRpc,
} from "@zenbujs/core/react"
import type { OpenMode } from "@/lib/window-state/types"
import { openViewInRoot } from "@/lib/window-state/panes/views"
import { useWindowId } from "@/lib/window-state/window-id"
import {
  useActiveChatId,
  useActiveScopeId,
  useActiveWorkspaceId,
} from "@/lib/window-state/active-view"
import { useSidebarActions } from "@/hooks/use-sidebar-actions"
import { openCreateWorktreeDialog } from "@/lib/create-worktree-dialog-store"
import { openArchiveWorktreeDialog } from "@/lib/archive-worktree-dialog-store"
import { STATIC_COMMANDS } from "./commands"
import type { Command } from "./types"

const VIEW_ACTIONS: ReadonlyArray<{
  mode: OpenMode
  label: string
  hint: string
}> = [
  { mode: "new-tab", label: "Open in new tab", hint: "new tab" },
  { mode: "replace", label: "Replace active pane", hint: "replace" },
  { mode: "split-right", label: "Open in split", hint: "split right" },
]

/**
 * Builds the live command list shown by the palette. Sources, in order:
 *
 *  1. **Static morph commands** (`STATIC_COMMANDS`) — the few palette
 *     entries that don't dispatch an action but instead morph the
 *     palette body into a custom React view (Apps, Create Zenbu app,
 *     Launch dev app). These live in the renderer because their UI
 *     can't be expressed as "call this RPC and close".
 *
 *  2. **Plugin-registered actions** (`root.app.paletteActions`) — the
 *     real registry. Plugins call `PaletteActionsService.register`
 *     from their own service setup blocks, supplying an RPC path
 *     `{plugin, service, method}`. We turn each entry into a
 *     `Command` whose `onSelect` dynamically dispatches that path.
 *     The RPC method is free to mutate the DB, emit events, call
 *     other services, etc. — that's where the power lives.
 *
 *  3. **Bespoke PR entries** — Pull Requests gets one row per
 *     sub-page × open-mode because each entry is an entry-point
 *     (not a navigation step), so the generic view-action triple
 *     below would clobber the focused tab on "replace".
 *
 *  4. **Auto-generated view actions** — for every registered pane
 *     view, emit one row per (view × mode) so users can open / split
 *     / replace any view from the palette without the view's owner
 *     having to register actions for every mode.
 *
 * Re-renders automatically when any of those sources change.
 */
export function useCommands(): Command[] {
  const registry = useInjections()
  const actions = useDb((root) => root.app.paletteActions)
  const dbClient = useDbClient()
  const rpc = useRpc()
  const windowId = useWindowId()
  // Active scope's directory so PR commands open against the right
  // repo on multi-window setups. Falls back to `null`, which lets the
  // `pull-requests` view do its own `windowStates` lookup.
  const activeDirectory = useDb((root) => {
    const ws = root.app.windowStates[windowId]
    if (!ws) return null
    const scopeId = ws.selectedScopeId
    if (!scopeId) return null
    return root.app.scopes[scopeId]?.directory ?? null
  })
  const activeScopeId = useActiveScopeId()
  const activeChatId = useActiveChatId()
  const activeWorkspaceId = useActiveWorkspaceId()
  const sidebar = useSidebarActions()

  return useMemo<Command[]>(() => {
    const out: Command[] = [...STATIC_COMMANDS]

    // -----------------------------------------------------------------
    // Worktree / chat shortcuts.
    //
    // These only appear when there's something to act on — keeping the
    // root palette uncluttered when no workspace is open. They
    // delegate to the same renderer-side handlers the sidebar uses so
    // the DB updates / selection bookkeeping stay in one place.
    // -----------------------------------------------------------------
    if (activeWorkspaceId) {
      out.push({
        id: "create-worktree",
        label: "New worktree",
        hint: "worktree",
        onSelect: () => {
          // Re-uses the existing modal — same flow as the sidebar's
          // split-button entry point.
          openCreateWorktreeDialog(null)
        },
      })
    }
    if (activeChatId) {
      out.push({
        id: "archive-chat",
        label: "Archive chat",
        hint: "chat",
        onSelect: () => {
          sidebar.archiveChat(activeChatId)
        },
      })
    }
    if (activeScopeId) {
      out.push({
        id: "archive-worktree",
        label: "Archive worktree",
        hint: "worktree",
        onSelect: () => {
          // Route through the confirmation dialog so the user gets
          // a chance to also delete the worktree directory on disk.
          openArchiveWorktreeDialog(activeScopeId)
        },
      })
    }

    // -----------------------------------------------------------------
    // 2. Plugin-registered actions
    //
    // Ordered alphabetically by label so the list is stable across
    // renders even though the underlying record has no inherent order.
    // -----------------------------------------------------------------
    const registeredActions = Object.values(actions ?? {}).sort((a, b) =>
      a.label.localeCompare(b.label),
    )
    for (const action of registeredActions) {
      out.push({
        id: action.id,
        label: action.label,
        hint: action.hint ?? undefined,
        // No `icon` field anymore — the palette is label-only. The DB
        // shape no longer carries `icon`, the registration API no
        // longer accepts it, and the root-menu doesn't render an icon
        // slot. See the comment in `paletteAction` (schema).
        onSelect: async () => {
          // The RPC router is built on a JS Proxy that turns bracket
          // access into a path, so dynamic dispatch works without
          // the renderer having to know the shape of any individual
          // plugin's API.
          //
          // We type-erase the proxy here because TS only sees the
          // statically-known router, but the runtime accepts any
          // path. Errors (missing method, etc.) surface as RPC
          // rejections.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const router = rpc as any
          const fn =
            router?.[action.rpc.plugin]?.[action.rpc.service]?.[
              action.rpc.method
            ]
          if (typeof fn !== "function") {
            console.error(
              "[command-palette] action handler not found:",
              action.id,
              action.rpc,
            )
            return
          }
          try {
            // Always pass `{ windowId }`. If the action registered
            // extra `args`, merge them in — the registered values
            // win on collision so a parameterized action can pin
            // its own keys (e.g. `focusPane` setting `index`).
            await fn({ windowId, ...(action.args ?? {}) })
          } catch (err) {
            console.error(
              "[command-palette] action handler failed:",
              action.id,
              err,
            )
          }
        },
      })
    }

    // -----------------------------------------------------------------
    // 3. Bespoke PR entries
    //
    // Mirrors `VIEW_ACTIONS` minus "Replace active pane" — each PR
    // open is a fresh entry-point, not a navigation step. Dispatch
    // goes through the service so its in-memory cache is already
    // warming by the time the iframe mounts.
    // -----------------------------------------------------------------
    const PR_OPEN_MODES: ReadonlyArray<{
      openMode: "new-tab" | "split-right"
      label: string
      hint: string
    }> = [
      { openMode: "new-tab", label: "Open in new tab", hint: "new tab" },
      { openMode: "split-right", label: "Open in split", hint: "split right" },
    ]
    const PR_PAGES: ReadonlyArray<{
      id: string
      mode: "create" | "list"
      label: string
      hint: string
    }> = [
      {
        id: "create-pr",
        mode: "create",
        label: "Create pull request",
        hint: "new pr",
      },
      {
        id: "pull-requests",
        mode: "list",
        label: "Pull requests",
        hint: "open prs",
      },
    ]
    for (const page of PR_PAGES) {
      for (const action of PR_OPEN_MODES) {
        out.push({
          id: `${page.id}:${action.openMode}`,
          label: `${page.label}: ${action.label}`,
          hint: action.hint,
          onSelect: () => {
            void rpc.app.github.openPullRequestsView({
              mode: page.mode,
              directory: activeDirectory,
              openMode: action.openMode,
            })
          },
        })
      }
    }

    // -----------------------------------------------------------------
    // 4. Auto-generated view actions
    //
    // Only "normal" pane views — sidebar views and non-`view` kinds
    // (e.g. `"embed"` views that require args) are skipped. Pull
    // Requests is also skipped because (3) already covers it.
    // -----------------------------------------------------------------
    const views = registry
      .filter((v) => v.meta?.kind === "view")
      .filter((v) => v.name !== "pull-requests")
      .map((v) => ({
        type: v.name,
        label:
          typeof v.meta?.label === "string"
            ? v.meta.label
            : formatLabel(v.name),
      }))
      .sort((a, b) => a.label.localeCompare(b.label))

    for (const view of views) {
      for (const action of VIEW_ACTIONS) {
        out.push({
          id: `view:${view.type}:${action.mode}`,
          label: `${view.label}: ${action.label}`,
          hint: action.hint,
          onSelect: () => {
            void dbClient.update((root) => {
              openViewInRoot(root, windowId, view.type, action.mode)
            })
          },
        })
      }
    }

    return out
  }, [
    registry,
    actions,
    dbClient,
    rpc,
    windowId,
    activeDirectory,
    activeScopeId,
    activeChatId,
    activeWorkspaceId,
    sidebar,
  ])
}

function formatLabel(type: string): string {
  const tail = type.includes("/") ? type.split("/").pop()! : type
  return tail.replace(/[-_]/g, " ")
}
