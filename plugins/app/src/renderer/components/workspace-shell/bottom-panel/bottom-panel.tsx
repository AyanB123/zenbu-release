import { useEffect, useMemo, useRef, useState } from "react"
import { View } from "@zenbujs/core/react"
import { BottomPanelTabBar } from "./bottom-panel-tab-bar"
import type { BottomPanelViewEntry } from "@/lib/bottom-panel-views"

export type BottomPanelProps = {
  views: BottomPanelViewEntry[]
  /** The currently active view type. Caller guarantees non-null. */
  openType: string
  onSelectType: (type: string) => void
  /** Args every embedded view receives. Currently scope coordinates
   * (so the terminal knows what cwd to spawn in), but plugins are
   * free to read anything they need off of it. Forwarded via
   * `?args=` for iframe-mode views; component views receive it as a
   * `ViewComponentProps['args']` prop. */
  args: Record<string, unknown>
  /** Whether the bottom panel is currently open. The body stays
   * mounted across opens/closes so views don't pay reload cost, but
   * we use this signal to pull focus into the active view whenever
   * the panel transitions to open. */
  panelOpen?: boolean
}

/**
 * Bottom-panel host. Renders the active bottom-panel view in the
 * main area and a vertical icon strip on the right. Previously-opened
 * views stay mounted (hidden) so re-selecting one is an instant
 * visibility flip rather than a re-mount.
 *
 * Owns its focus lifecycle end-to-end: when the panel opens (or the
 * active view changes), keyboard focus goes into the active view's
 * iframe; when the panel closes, focus is pulled out of whatever
 * was in the panel and returned to the window. Generic over view
 * type — plugins that contribute bottom-panel views get this for
 * free without the shell needing to know about them.
 */
export function BottomPanel({
  views,
  openType,
  onSelectType,
  args,
  panelOpen = true,
}: BottomPanelProps) {
  const [visited, setVisited] = useState<Set<string>>(() => new Set([openType]))
  // Container for the entire panel (tab bar + content). Used by the
  // close-path focus effect to check whether `document.activeElement`
  // lives inside the panel without naming a specific view type.
  const containerRef = useRef<HTMLDivElement | null>(null)
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

  // Open / active-view-change focus.
  //
  // Parent → child focus push. When the panel was opened via a
  // shortcut the main process intercepts in `before-input-event`
  // (e.g. ⌘J), the renderer never sees the keydown, so a
  // `focus()` from inside the view has no user activation and is
  // silently rejected by Chrome. The host (this component) does
  // have a valid context, so we drive focus from here.
  //
  // We support two view styles:
  //   - Iframe views: focus the `<iframe>` element directly.
  //   - Component views: focus the first descendant tagged
  //     `[data-bottom-panel-focus-target]`. The view is responsible
  //     for adding `tabIndex={-1}` so it's programmatically
  //     focusable, and for routing the resulting `focus` event to
  //     whatever internal element should actually own keystrokes
  //     (e.g. the xterm canvas).
  //
  // Defer to rAF so React has committed the `display: block` flip
  // first — a hidden element isn't focusable.
  useEffect(() => {
    if (!panelOpen) return
    const wrapper = wrappersRef.current.get(openType)
    if (!wrapper) return
    const raf = requestAnimationFrame(() => {
      const iframe = wrapper.querySelector("iframe")
      if (iframe instanceof HTMLIFrameElement) {
        try { iframe.focus() } catch {}
        return
      }
      const target = wrapper.querySelector<HTMLElement>(
        "[data-bottom-panel-focus-target]",
      )
      if (target) {
        try { target.focus() } catch {}
      }
    })
    return () => cancelAnimationFrame(raf)
  }, [openType, visited, panelOpen])

  // Close focus restore.
  //
  // Allotment's `visible={false}` only collapses the pane's size;
  // for component views the keystroke target (e.g. ghostty's
  // contenteditable) stays in the DOM as `document.activeElement`
  // and keeps swallowing keystrokes — breaking any parent shortcut
  // wired as a window `keydown` listener (⌘G, command palette,
  // find-in-chat). On close, if focus is parked inside the panel,
  // blur it. We deliberately do NOT call `window.focus()` after
  // blurring: in iframe mode that was a no-op (focus was on the
  // iframe window, not ours), but in component mode it dispatches
  // a window `focus` event in this renderer that any view listening
  // for window focus would catch and use to re-grab focus. Letting
  // focus naturally fall to `document.body` is enough — the
  // window's `keydown` listeners run regardless of where focus
  // sits in the document.
  //
  // Only acts on the open→closed transition so closing while focus
  // is elsewhere (e.g. the composer) doesn't yank it back.
  const wasOpenRef = useRef(panelOpen)
  useEffect(() => {
    const wasOpen = wasOpenRef.current
    wasOpenRef.current = panelOpen
    if (wasOpen === panelOpen || panelOpen) return
    const container = containerRef.current
    if (!container) return
    const active = document.activeElement
    if (active instanceof HTMLElement && container.contains(active)) {
      active.blur()
    }
  }, [panelOpen])

  const visibleViews = useMemo(
    () => views.filter(v => visited.has(v.type)),
    [views, visited],
  )

  return (
    <div
      ref={containerRef}
      className="flex h-full min-h-0 w-full flex-row overflow-hidden"
    >
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
