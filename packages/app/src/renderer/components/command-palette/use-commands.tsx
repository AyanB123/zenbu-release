import { useMemo } from "react"
import { useDb, useDbClient } from "@zenbujs/core/react"
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

  return useMemo<Command[]>(() => {
    const out: Command[] = [...STATIC_COMMANDS]

    const views = registry
      // Only normal pane views are openable from the palette: skip
      // sidebar views (they live in the right sidebar and are not
      // meant to embed inline) and skip non-`view` kinds like the
      // `"embed"` views that need args to be useful (e.g. `file`).
      .filter(v => v.meta?.kind === "view" && v.meta?.sidebar !== true)
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
  }, [registry, dbClient, windowId])
}

function formatLabel(type: string): string {
  const tail = type.includes("/") ? type.split("/").pop()! : type
  return tail.replace(/[-_]/g, " ")
}
