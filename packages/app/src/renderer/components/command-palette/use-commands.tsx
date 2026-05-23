import { useMemo } from "react"
import { useDb, useDbClient, useRpc } from "@zenbujs/core/react"
import {
  openViewInRoot,
  type OpenMode,
} from "@/lib/window-state"
import { useWindowId } from "@/lib/window-state"
import { COMMANDS as STATIC_COMMANDS } from "./commands"
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
 * Combines the static command list with one row per (registered view ×
 * pane action). For now we inline every action into the root menu —
 * noisy but flat. Later each view will be able to register its own
 * verbs (see `meta` on the view registry); this hook is the
 * single place that has to learn about them.
 */
export function useCommands(): Command[] {
  const registry = useDb(root => root.core.lastKnownViewRegistry ?? [])
  const dbClient = useDbClient()
  const windowId = useWindowId()
  const rpc = useRpc()
  // Active scope's directory so PR commands open against the right
  // repo on multi-window setups. Falls back to `null`, which lets the
  // `pull-requests` view do its own `windowStates` lookup.
  const activeDirectory = useDb(root => {
    const ws = root.app.windowStates[windowId]
    if (!ws) return null
    const scopeId = ws.selectedScopeId
    if (!scopeId) return null
    return root.app.scopes[scopeId]?.directory ?? null
  })

  return useMemo<Command[]>(() => {
    const out: Command[] = [...STATIC_COMMANDS]

    // GitHub-flavored PR commands. All three open the same view —
    // `/create pr` and `/tree` land on the composer, `/pr` lands on
    // the open-PRs list. We define them here (not in static COMMANDS)
    // because they need `dbClient` + `windowId` to actually open the
    // view, and slash-commands are matched as a prefix by the same
    // fuzzy filter the palette already uses for `label`.
    // Bespoke entries for the two PR sub-pages. We mirror the
    // standard `VIEW_ACTIONS` triple but drop "Replace active
    // pane" — opening a PR is always an entry-point, not a
    // navigation step, so replace would just clobber whatever tab
    // happens to be focused. Dispatch goes through the service so
    // its in-memory cache is already warming by the time the
    // iframe mounts.
    const PR_OPEN_MODES: ReadonlyArray<{
      openMode: "new-tab" | "split-right"
      label: string
      hint: string
    }> = [
      { openMode: "new-tab", label: "Open in new tab", hint: "new tab" },
      { openMode: "split-right", label: "Open in split", hint: "split right" },
    ]
    const prIcon = registry.find(v => v.type === "pull-requests")?.icon
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
          icon: prIcon ? (
            <span
              aria-hidden
              className="inline-flex size-4 shrink-0 items-center justify-center text-muted-foreground"
              dangerouslySetInnerHTML={{ __html: prIcon }}
            />
          ) : undefined,
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

    const views = registry
      // Only normal pane views are openable from the palette: skip
      // sidebar views (they live in the right sidebar and are not
      // meant to embed inline) and skip non-`view` kinds like the
      // `"embed"` views that need args to be useful (e.g. `file`).
      .filter(v => v.meta?.kind === "view" && v.meta?.sidebar !== true)
      // Pull Requests gets bespoke palette entries below (one per
      // sub-page: "Create pull request" / "Pull requests"). The
      // generic auto-registered triple would always land on the
      // composer, hide the list page, and clutter the palette with
      // a meaningless "Replace active pane" — each PR open is a
      // fresh entry-point, not a navigation step.
      .filter(v => v.type !== "pull-requests")
      .map(v => ({
        type: v.type,
        label: v.meta?.label ?? formatLabel(v.type),
        icon: v.icon,
      }))
      .sort((a, b) => a.label.localeCompare(b.label))

    for (const view of views) {
      for (const action of VIEW_ACTIONS) {
        out.push({
          id: `view:${view.type}:${action.mode}`,
          label: `${view.label}: ${action.label}`,
          hint: action.hint,
          icon: view.icon ? (
            <span
              aria-hidden
              className="inline-flex size-4 shrink-0 items-center justify-center text-muted-foreground"
              dangerouslySetInnerHTML={{ __html: view.icon }}
            />
          ) : undefined,
          onSelect: () => {
            void dbClient.update(root => {
              openViewInRoot(root, windowId, view.type, action.mode)
            })
          },
        })
      }
    }

    return out
  }, [registry, dbClient, windowId, activeDirectory, rpc])
}

function formatLabel(type: string): string {
  const tail = type.includes("/") ? type.split("/").pop()! : type
  return tail.replace(/[-_]/g, " ")
}
