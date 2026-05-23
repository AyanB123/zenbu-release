import { useEffect, useMemo, useRef, useState } from "react"
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
  /** Whether the bottom panel is currently open. The body stays
   * mounted across opens/closes so its iframes don't pay reload cost,
   * but we use this signal to pull focus into the active view's
   * iframe whenever the panel transitions to open. */
  panelOpen?: boolean
}

/**
 * Bottom-panel host. Renders the active bottom-panel view in the
 * main area and a vertical icon strip on the right for switching
 * between registered bottom-panel views. Previously-opened views
 * stay mounted (hidden) so re-selecting one is an instant visibility
 * flip rather than a re-mount.
 *
 * Whenever the active view changes (including the panel itself
 * being opened from the title bar) we pull keyboard focus into that
 * view's iframe. Without this, the terminal's `term.focus()` call
 * inside the iframe lights up the cursor visually but keystrokes
 * stay in the parent shell — the "looks focused but isn't" bug.
 */
export function BottomPanelBody({
  views,
  openType,
  onSelectType,
  args,
  panelOpen = true,
}: BottomPanelBodyProps) {
  const [visited, setVisited] = useState<Set<string>>(() => new Set([openType]))
  // One wrapper per visited view; we read the underlying iframe out
  // of it on focus changes. Keyed by view type so the right iframe
  // gets focus.
  const wrappersRef = useRef<Map<string, HTMLDivElement | null>>(new Map())

  useEffect(() => {
    setVisited(prev => {
      if (prev.has(openType)) return prev
      const next = new Set(prev)
      next.add(openType)
      return next
    })
  }, [openType])

  // When the active view changes OR the panel transitions to open,
  // focus that view's iframe. We defer to rAF so React has committed
  // the `display: block` flip first; focusing a `display:none`
  // iframe is a no-op in Chromium.
  useEffect(() => {
    if (!panelOpen) return
    const wrapper = wrappersRef.current.get(openType)
    if (!wrapper) return
    const raf = requestAnimationFrame(() => {
      const iframe = wrapper.querySelector("iframe")
      if (iframe instanceof HTMLIFrameElement) {
        try { iframe.focus() } catch {}
      }
    })
    return () => cancelAnimationFrame(raf)
  }, [openType, visited, panelOpen])

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
            ref={el => {
              if (el) wrappersRef.current.set(view.type, el)
              else wrappersRef.current.delete(view.type)
            }}
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
