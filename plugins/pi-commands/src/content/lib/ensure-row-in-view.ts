/** Keep a keyboard-selected row visible inside a scroll container. */
export function ensureRowInView(
  container: HTMLElement,
  row: HTMLElement,
): void {
  const cRect = container.getBoundingClientRect()
  const rRect = row.getBoundingClientRect()
  const topDelta = rRect.top - cRect.top
  const bottomDelta = rRect.bottom - cRect.top
  if (topDelta < 0) {
    container.scrollTop += topDelta
  } else if (bottomDelta > container.clientHeight) {
    container.scrollTop += bottomDelta - container.clientHeight
  }
}
