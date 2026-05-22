import { useMemo } from "react"
import { useDb } from "@zenbujs/core/react"

export type BottomPanelViewEntry = {
  /** Registered view type (e.g. `"terminal"`). Used as the tab key. */
  type: string
  label: string
  iconSvg?: string
}

type RegistryEntry = {
  type: string
  url: string
  port: number
  icon?: string
  meta?: {
    kind?: string
    bottomPanel?: boolean
    label?: string
  }
}

/**
 * Every view in the view registry tagged `meta.bottomPanel === true`.
 * The host shell renders one of these at a time inside the bottom
 * panel (analogous to `useSidebarViews` for the right sidebar).
 *
 * Plugins opt-in by passing `meta: { bottomPanel: true, label: "\u2026" }`
 * to `viewRegistry.registerAlias()`. The order in the registry is
 * stable, so the first registered view doubles as the default
 * selection when a window has no `bottomPanelView` set.
 */
export function useBottomPanelViews(): BottomPanelViewEntry[] {
  const registry = useDb(
    root => root.core.lastKnownViewRegistry ?? [],
  ) as RegistryEntry[]

  return useMemo<BottomPanelViewEntry[]>(() => {
    const out: BottomPanelViewEntry[] = []
    for (const entry of registry) {
      if (entry.meta?.kind === "entrypoint") continue
      if (entry.meta?.bottomPanel !== true) continue
      out.push({
        type: entry.type,
        label: entry.meta?.label ?? formatLabel(entry.type),
        iconSvg: entry.icon,
      })
    }
    return out
  }, [registry])
}

function formatLabel(type: string): string {
  const tail = type.includes("/") ? type.split("/").pop()! : type
  return tail.replace(/[-_]/g, " ")
}
