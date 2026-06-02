import { useMemo } from "react"
import { useInjections } from "@zenbujs/core/react"

/**
 * Title-bar contribution surface.
 *
 * A plugin contributes to the workspace title-bar's right slot
 * (between the center label and the right-sidebar toggle) by
 * injecting under `meta.kind: "title-bar"`. Conventional meta:
 *
 *   meta: {
 *     kind: "title-bar",
 *     order: <number>,      // ascending; missing = sinks to the right
 *     label?: <string>,     // used only as React key fallback
 *   }
 *
 * The button is mounted by `WorkspaceTitleBar` via
 * `<View name={entry.type} args={...} />` and receives uniform
 * args (workspace/scope/directory) so each contribution can decide
 * whether and how to render.
 *
 * The built-ins ship as plugins too:
 *
 *   0  plugin-dev-buttons
 *   1  open-in-button
 *   2  play-button
 *   10 auto-updater-button
 */
export type TitleBarViewEntry = {
  type: string
  order: number
}

export function useTitleBarViews(): TitleBarViewEntry[] {
  const entries = useInjections({ kind: "title-bar" })

  return useMemo<TitleBarViewEntry[]>(() => {
    const out: TitleBarViewEntry[] = entries.map(entry => ({
      type: entry.name,
      order:
        typeof entry.meta?.order === "number"
          ? entry.meta.order
          : Number.POSITIVE_INFINITY,
    }))
    out.sort((a, b) => a.order - b.order)
    return out
  }, [entries])
}

/**
 * Uniform `args` shape passed to every title-bar contribution.
 *
 * Centralising the type here means the host and every plugin
 * agree on the contract \u2014 the title-bar doesn't need to know
 * which slots a given contribution wants. Each plugin's view
 * component reads only the fields it cares about and decides
 * whether to render anything at all (e.g. `OpenIn` hides when
 * `directory == null`).
 */
export type TitleBarViewArgs = {
  workspaceId: string | null
  scopeId: string | null
  directory: string | null
}
