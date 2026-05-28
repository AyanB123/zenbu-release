import type { ComponentType } from "react"
import { useMemo } from "react"
import { useDb, useFunctions } from "@zenbujs/core/react"

/**
 * Discovery hook for the host's footer slot (`PiFooter`).
 *
 * Sibling of `useSidebarViews` / `useLeftSidebarViews` /
 * `useWorkspaceRailViews` over in `sidebar-views.ts` — same pattern
 * (read the registry, filter by `meta.kind`, sort by
 * `meta.order` with registration order as the tiebreaker) but with
 * one extra wrinkle:
 *
 * Footer items can arrive through **two** registration paths, and
 * the host renders both:
 *
 *   1. **Service-registered component views.** A plugin calls
 *      `viewRegistry.registerView({ rendering: "component",
 *      source, meta: { kind: "pi-footer.item", … } })`. The entry
 *      shows up in `core.lastKnownViewRegistry`. Rendered as
 *      `<View type={entry.type} args={{ sessionId }} />` so items
 *      receive `sessionId` via the standard `useViewArgs` prop.
 *
 *   2. **Renderer-registered functions.** A plugin (typically a
 *      content script) calls `useRegisterFunction(name, Component,
 *      { kind: "pi-footer.item", … })`. The component lives only
 *      in the renderer's in-process function registry. Rendered as
 *      `<Component />` — no args (the component is expected to
 *      read what it needs from db / its own store, as `cm-vim`'s
 *      mode indicator does).
 *
 * Items are split by `meta.position` (`"left"` default) and sorted
 * by `meta.order` ascending. The view-registry entries' positions
 * in the returned array are stable across renders that don't
 * touch the registry, the same way `useWorkspaceRailViews` is
 * stable.
 */

export type FooterItemPosition = "left" | "right"

export type FooterItem =
  | {
      kind: "view"
      key: string
      viewType: string
      position: FooterItemPosition
      order: number
      registryIndex: number
    }
  | {
      kind: "fn"
      key: string
      Component: ComponentType
      position: FooterItemPosition
      order: number
      registryIndex: number
    }

function readOrder(meta: Record<string, unknown> | undefined): number {
  const v = meta?.order
  return typeof v === "number" ? v : 0
}

function readPosition(
  meta: Record<string, unknown> | undefined,
): FooterItemPosition {
  return meta?.position === "right" ? "right" : "left"
}

function compareByOrder(a: FooterItem, b: FooterItem): number {
  if (a.order !== b.order) return a.order - b.order
  return a.registryIndex - b.registryIndex
}

export function useFooterItems(): {
  left: FooterItem[]
  right: FooterItem[]
} {
  const registry = useDb(root => root.core.lastKnownViewRegistry ?? [])
  const fnItems = useFunctions<ComponentType>({ kind: "pi-footer.item" })

  return useMemo(() => {
    const items: FooterItem[] = []

    registry.forEach((entry, registryIndex) => {
      if (entry.meta?.kind !== "pi-footer.item") return
      items.push({
        kind: "view",
        key: `view:${entry.type}`,
        viewType: entry.type,
        position: readPosition(entry.meta),
        order: readOrder(entry.meta),
        registryIndex,
      })
    })

    // Offset function-registry entries past every view-registry
    // entry so on `order` ties the view-registered (first-party)
    // items stay before function-registered (typically content
    // script) items.
    const fnOffset = registry.length
    fnItems.forEach((entry, i) => {
      items.push({
        kind: "fn",
        key: `fn:${entry.name}`,
        Component: entry.fn,
        position: readPosition(entry.meta),
        order: readOrder(entry.meta),
        registryIndex: fnOffset + i,
      })
    })

    const left = items.filter(i => i.position === "left").sort(compareByOrder)
    const right = items
      .filter(i => i.position === "right")
      .sort(compareByOrder)
    return { left, right }
  }, [registry, fnItems])
}
