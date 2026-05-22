import { useEffect, useMemo, useState } from "react"
import { View } from "@zenbujs/core/react"
import { BottomPanelTabBar } from "./bottom-panel-tab-bar"
import type { BottomPanelViewEntry } from "@/lib/bottom-panel-views"

export type BottomPanelBodyProps = {
  views: BottomPanelViewEntry[]
  /** The currently active view type. Caller guarantees non-null. */
  openType: string
  onSelectType: (type: string) => void
  /** Args every embedded view receives. Currently scope coordinates
   * (so the terminal knows what cwd to spawn in), but plugins are
   * free to read anything they need off of it. Forwarded via
   * `?args=` into the iframe; views read with `useViewArgs()`. */
  args: Record<string, unknown>
}

/**
 * Bottom-panel host. Renders the active bottom-panel view in the
 * main area and a vertical icon strip on the right for switching
 * between registered bottom-panel views. Previously-opened views
 * stay mounted (hidden) so re-selecting one is an instant visibility
 * flip rather than a re-mount.
 */
export function BottomPanelBody({
  views,
  openType,
  onSelectType,
  args,
}: BottomPanelBodyProps) {
  const [visited, setVisited] = useState<Set<string>>(() => new Set([openType]))

  useEffect(() => {
    setVisited(prev => {
      if (prev.has(openType)) return prev
      const next = new Set(prev)
      next.add(openType)
      return next
    })
  }, [openType])

  const visibleViews = useMemo(
    () => views.filter(v => visited.has(v.type)),
    [views, visited],
  )

  return (
    <div className="flex h-full min-h-0 w-full flex-row overflow-hidden">
      <div className="relative min-h-0 min-w-0 flex-1">
        {visibleViews.map(view => (
          <div
            key={view.type}
            className="absolute inset-0"
            style={{ display: view.type === openType ? "block" : "none" }}
          >
            <View
              type={view.type}
              args={args}
              className="size-full"
              fallback={
                <div className="flex h-full items-center justify-center text-[11px] text-muted-foreground">
                  Loading view…
                </div>
              }
            />
          </div>
        ))}
      </div>
      <BottomPanelTabBar
        views={views}
        activeType={openType}
        onSelect={onSelectType}
      />
    </div>
  )
}
