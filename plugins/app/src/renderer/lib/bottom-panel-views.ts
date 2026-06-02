import { useMemo } from "react"
import { useInjections } from "@zenbujs/core/react"

export type BottomPanelViewEntry = {
  /** Injection name (used as the tab key + `<View name=>` lookup). */
  type: string
  label: string
  iconSvg?: string
}

/**
 * Every injection tagged `meta.kind: "bottom-panel"`. The host
 * shell renders one of these at a time inside the bottom panel
 * (analogous to `useSidebarViews` for the right sidebar).
 *
 * Plugins opt in by passing `meta: { kind: "bottom-panel", label }`
 * to `this.inject(...)`. The order in the registry is stable, so
 * the first registered injection doubles as the default selection
 * when a window has no `bottomPanelView` set.
 */
export function useBottomPanelViews(): BottomPanelViewEntry[] {
  const entries = useInjections({ kind: "bottom-panel" })

  return useMemo<BottomPanelViewEntry[]>(() => {
    return entries.map(entry => ({
      type: entry.name,
      label:
        typeof entry.meta?.label === "string"
          ? entry.meta.label
          : formatLabel(entry.name),
      iconSvg:
        typeof entry.meta?.icon === "string" ? entry.meta.icon : undefined,
    }))
  }, [entries])
}

function formatLabel(name: string): string {
  const tail = name.includes("/") ? name.split("/").pop()! : name
  return tail.replace(/[-_]/g, " ")
}
