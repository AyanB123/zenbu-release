import type { ComponentType } from "react"
import { useMemo } from "react"
import { useInjections } from "@zenbujs/core/react"

/**
 * Discovery hook for the host's footer slot (`PiFooter`).
 *
 * One source: every injection tagged `meta.kind: "footer.item"`.
 * Items can be registered either as a module-load injection
 * (`this.inject(...)` from a plugin service) or as a renderer-side
 * reactive injection (`useRegisterInjection(...)` inside a mounted
 * React tree). Both write to the same registry; this hook reads
 * both styles uniformly.
 *
 * Items are split by `meta.position` (`"left"` default) and sorted
 * by `meta.order` ascending.
 *
 * Rendering convention: the host renders each item as
 * `<View name={item.viewType} args={{ sessionId }} />`. Injections
 * whose `value` is a React component receive `args.sessionId`
 * automatically; items that don't need it ignore the prop.
 */

export type FooterItemPosition = "left" | "right"

export type FooterItem = {
  key: string
  viewType: string
  position: FooterItemPosition
  order: number
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

export function useFooterItems(): {
  left: FooterItem[]
  right: FooterItem[]
} {
  const entries = useInjections<ComponentType>({ kind: "footer.item" })

  return useMemo(() => {
    const items = entries.map((entry, registryIndex) => ({
      key: entry.name,
      viewType: entry.name,
      position: readPosition(entry.meta),
      order: readOrder(entry.meta),
      registryIndex,
    }))

    const compare = (
      a: (typeof items)[number],
      b: (typeof items)[number],
    ) => (a.order !== b.order ? a.order - b.order : a.registryIndex - b.registryIndex)

    const stripIndex = ({ registryIndex: _, ...rest }: (typeof items)[number]) =>
      rest

    const left = items
      .filter(i => i.position === "left")
      .sort(compare)
      .map(stripIndex)
    const right = items
      .filter(i => i.position === "right")
      .sort(compare)
      .map(stripIndex)

    return { left, right }
  }, [entries])
}
