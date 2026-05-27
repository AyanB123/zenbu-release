/**
 * Keep a keyboard-selected row visible inside a scroll container.
 *
 * This is the manual equivalent of `row.scrollIntoView({ block:
 * "nearest" })`, which on its own has bad failure modes for our
 * popup menus:
 *
 *   1. It walks up the DOM and scrolls *every* ancestor that's
 *      scrollable, which can yank the chat scrollback (or the page
 *      itself) when the user is only trying to scrub a small menu.
 *   2. Its "fully visible" check is subpixel-sensitive: when the
 *      newly-selected row is rendered _just below_ the viewport edge
 *      (e.g. clipped by 1px due to flex/border rounding), Chromium
 *      sometimes treats it as in-view and skips the scroll until the
 *      next keystroke nudges it.
 *
 * We compute positions with `getBoundingClientRect` rather than
 * `offsetTop`. `offsetTop` is relative to the nearest *positioned*
 * ancestor, not the scroll container — if the container isn't
 * `position: relative` (which is the case for our tree/slash/palette
 * scrollers) `offsetTop` ends up relative to the document and the
 * comparison silently breaks. Rect math is reference-frame-agnostic
 * so it Just Works regardless of layout.
 *
 * Pair this with `useLayoutEffect` (not `useEffect`) so the scroll
 * lands in the same paint as the highlight change.
 */
export function ensureRowInView(
  container: HTMLElement,
  row: HTMLElement,
): void {
  const cRect = container.getBoundingClientRect()
  const rRect = row.getBoundingClientRect()
  // Distance from the row's top/bottom to the container's visible
  // top edge. Positive means below the top edge; negative means
  // clipped above it.
  const topDelta = rRect.top - cRect.top
  const bottomDelta = rRect.bottom - cRect.top
  if (topDelta < 0) {
    // Row is (partially) above the viewport — scroll up just enough
    // to bring its top edge flush with the container top.
    container.scrollTop += topDelta
  } else if (bottomDelta > container.clientHeight) {
    // Row is (partially) below the viewport — scroll down just
    // enough to bring its bottom edge flush with the container
    // bottom.
    container.scrollTop += bottomDelta - container.clientHeight
  }
}
