import { useCallback } from "react"

/** How many rows count as a "half page" for Ctrl-D/U. Matches the
 * visible row count on the palette at default sizing closely enough
 * that the jumps feel like vim's `^d` / `^u`. */
const HALF_PAGE = 8

export function useArrowNav(
  length: number,
  setSelected: (next: number | ((s: number) => number)) => void,
) {
  return useCallback(
    (e: React.KeyboardEvent): boolean => {
      const plainCtrl =
        e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey
      if (
        e.key === "ArrowDown" ||
        (plainCtrl && (e.key === "n" || e.key === "N"))
      ) {
        e.preventDefault()
        if (length > 0) setSelected(s => (s + 1) % length)
        return true
      }
      if (
        e.key === "ArrowUp" ||
        (plainCtrl && (e.key === "p" || e.key === "P"))
      ) {
        e.preventDefault()
        if (length > 0) setSelected(s => (s - 1 + length) % length)
        return true
      }
      // Ctrl-D / Ctrl-U: vim-style half-page jumps. Unlike Ctrl-N/P
      // these *clamp* at the ends instead of wrapping — wrapping a
      // half-page jump is disorienting in a search list.
      if (plainCtrl && (e.key === "d" || e.key === "D")) {
        e.preventDefault()
        if (length > 0) {
          setSelected(s => Math.min(length - 1, s + HALF_PAGE))
        }
        return true
      }
      if (plainCtrl && (e.key === "u" || e.key === "U")) {
        e.preventDefault()
        if (length > 0) setSelected(s => Math.max(0, s - HALF_PAGE))
        return true
      }
      return false
    },
    [length, setSelected],
  )
}
