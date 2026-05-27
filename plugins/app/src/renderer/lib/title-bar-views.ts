import { useMemo } from "react"
import { useDb } from "@zenbujs/core/react"

/**
 * Title-bar contribution surface.
 *
 * A plugin can contribute a component view to the workspace
 * title-bar's right slot (between the center label and the
 * right-sidebar toggle) by registering with:
 *
 *   meta: {
 *     kind: "title-bar",
 *     titleBarOrder: <number>,
 *     label?: <string>,        // used only as React key fallback
 *   }
 *
 * The button is mounted by `WorkspaceTitleBar` via `<View>` and
 * receives uniform args (workspace/scope/directory) so each
 * contribution can decide whether and how to render.
 *
 * Ordering: ascending `titleBarOrder` (defaults to +Infinity if
 * missing, so unordered contributions sink to the right). The
 * built-ins ship as plugins too:
 *
 *   1  open-in-button
 *   2  play-button
 *
 * (The marketplace title-bar button was removed when the
 * plugins root view absorbed both surfaces.)
 */
export type TitleBarViewEntry = {
  type: string
  order: number
}

type RegistryEntry = {
  type: string
  meta?: {
    kind?: string
    titleBarOrder?: number
  }
}

export function useTitleBarViews(): TitleBarViewEntry[] {
  const registry = useDb(
    root => root.core.lastKnownViewRegistry ?? [],
  ) as RegistryEntry[]

  return useMemo<TitleBarViewEntry[]>(() => {
    const out: TitleBarViewEntry[] = []
    for (const entry of registry) {
      if (entry.meta?.kind !== "title-bar") continue
      out.push({
        type: entry.type,
        order:
          typeof entry.meta?.titleBarOrder === "number"
            ? entry.meta.titleBarOrder
            : Number.POSITIVE_INFINITY,
      })
    }
    out.sort((a, b) => a.order - b.order)
    return out
  }, [registry])
}

/**
 * Uniform `args` shape passed to every title-bar contribution.
 *
 * Centralising the type here means the host and every plugin
 * agree on the contract — the title-bar doesn't need to know
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
