import { useEffect, useRef } from "react"

/**
 * Mouse-intent gate for keyboard-navigable popup menus.
 *
 * The problem: when a popup menu (slash menu, /tree, /fork, command
 * palette, etc.) appears under the user's pointer, the browser fires
 * `mouseenter`/`mouseover` on whichever row happens to be beneath the
 * cursor. If the row's hover handler unconditionally claims
 * selection, the menu opens with the highlight wherever the mouse
 * randomly was — instead of at the menu's natural initial position
 * (top of list, active leaf, etc.). Users see "first row selected
 * was the one my cursor was over when I opened the menu".
 *
 * The fix follows the same idea as cmdk and Radix: only let the
 * mouse claim selection once the user has actually moved the pointer
 * since this hook mounted. `pointermove` does not fire for "the
 * cursor was already there when the element appeared", so it sounds
 * like a reliable signal of intent — except Chromium *does*
 * synthesise a stray `pointermove` whenever a layout shift slides
 * something under a stationary cursor (which happens the instant a
 * palette mounts and the focused input pushes content down by a
 * pixel). Those fake moves report the *same* (clientX, clientY) as
 * before, so we filter them out: only count moves whose coordinates
 * differ from the last seen pair. Real user motion always produces
 * new coordinates; the synthetic reflow pings always reuse the old
 * ones.
 *
 * And whenever the user does keyboard nav we reset back to "no
 * intent yet" — that way if the cursor is parked over a different
 * row, it won't immediately re-claim selection on the next render;
 * the user has to wiggle the mouse to switch back to mouse mode.
 *
 * Usage:
 *
 * ```tsx
 * const hover = useHoverIntent()
 *
 * function onKeyDown(e) {
 *   if (isNavKey(e)) {
 *     hover.resetToKeyboard()
 *     move(...)
 *   }
 * }
 *
 * <Row onMouseMove={() => { if (hover.isActive()) setSelected(i) }} />
 * ```
 */
export function useHoverIntent(): {
  /** True once the pointer has moved since the last reset. */
  isActive: () => boolean
  /** Call from keyboard-nav handlers to suppress stale hover until
   *  the next real mouse movement. */
  resetToKeyboard: () => void
} {
  const activeRef = useRef(false)
  useEffect(() => {
    activeRef.current = false
    let lastX: number | null = null
    let lastY: number | null = null
    const onMove = (e: PointerEvent) => {
      if (lastX !== null && e.clientX === lastX && e.clientY === lastY) {
        // Layout-shift synthetic pointermove — cursor didn't actually
        // move, the page moved under it. Ignore so a freshly-mounted
        // palette doesn't immediately enter "mouse mode" from a
        // stationary cursor.
        return
      }
      lastX = e.clientX
      lastY = e.clientY
      activeRef.current = true
    }
    window.addEventListener("pointermove", onMove)
    return () => window.removeEventListener("pointermove", onMove)
  }, [])
  return {
    isActive: () => activeRef.current,
    resetToKeyboard: () => {
      activeRef.current = false
    },
  }
}
