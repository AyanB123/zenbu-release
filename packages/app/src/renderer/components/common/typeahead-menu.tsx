import { useLayoutEffect, useRef } from "react"
import { cn } from "@/lib/utils"
import { Spinner } from "@/components/ui/spinner"
import type { TypeaheadItem } from "./markdown-typeahead"

const ROW_HEIGHT = 32
const MAX_VISIBLE = 8
const MENU_WIDTH = 320

/**
 * Popup attached to a CodeMirror caret, used by MarkdownEditor for
 * `@mention` / `#issue`-style typeahead. Mirrors the chat composer's
 * `FilePickerMenu` look-and-feel so the in-app mental model stays
 * uniform across the two editors.
 *
 * Renders for an *active* trigger regardless of result count — when
 * `items` is empty we surface `emptyLabel` so the user knows the
 * typeahead is working. The composer hides the menu in that case
 * because file paths are static and a fast-typing user would see
 * the popup flash; PR data is async + remote, so the explicit empty
 * state is more useful.
 */
export type TypeaheadMenuProps = {
  items: TypeaheadItem[]
  selectedIndex: number
  loading: boolean
  emptyLabel: string
  onSelect: (item: TypeaheadItem) => void
  onHover: (index: number) => void
  /** Viewport coordinate of the trigger character. The menu opens
   *  above this point so the caret stays visible. */
  anchor: { left: number; top: number; bottom: number } | null
}

export function TypeaheadMenu({
  items,
  selectedIndex,
  loading,
  emptyLabel,
  onSelect,
  onHover,
  anchor,
}: TypeaheadMenuProps) {
  const scrollerRef = useRef<HTMLDivElement | null>(null)

  // Keep the selected row in view as the user arrows through results.
  useLayoutEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const top = selectedIndex * ROW_HEIGHT
    const bottom = top + ROW_HEIGHT
    if (top < el.scrollTop) el.scrollTop = top
    else if (bottom > el.scrollTop + el.clientHeight)
      el.scrollTop = bottom - el.clientHeight
  }, [selectedIndex])

  const visibleRows = Math.max(1, Math.min(items.length || 1, MAX_VISIBLE))
  const viewportHeight = visibleRows * ROW_HEIGHT

  // Anchor to viewport — the host might be inside an iframe with its
  // own scroll context, so `position: fixed` against viewport coords
  // is more reliable than relative to the editor host.
  const left = anchor
    ? clamp(anchor.left, 8, window.innerWidth - MENU_WIDTH - 8)
    : 16
  const top = anchor ? Math.max(8, anchor.top - viewportHeight - 6) : 16

  return (
    <div
      style={{
        position: "fixed",
        left,
        top,
        width: MENU_WIDTH,
      }}
      className="z-50 overflow-hidden rounded-sm border border-border bg-popover text-popover-foreground shadow-xl"
      role="listbox"
    >
      <div
        ref={scrollerRef}
        className="relative overflow-y-auto p-0.5"
        style={{ height: viewportHeight }}
      >
        {items.length === 0 ? (
          // Loading: just a spinner, no caption — "Looking up
          // contributors…" / "Loading issues…" was noise. The user
          // already knows what they're typing into; the spinner is
          // the only signal they need.
          <div className="flex items-center gap-2 px-2 py-2 text-[12px] text-muted-foreground">
            {loading ? <Spinner className="size-3" /> : emptyLabel}
          </div>
        ) : (
          items.map((item, i) => {
            const isSelected = i === selectedIndex
            return (
              <div
                key={item.key}
                role="option"
                aria-selected={isSelected}
                onMouseEnter={() => onHover(i)}
                onMouseDown={e => {
                  // mousedown (not click) so CodeMirror doesn't lose
                  // focus before we dispatch the insertion.
                  e.preventDefault()
                  onSelect(item)
                }}
                style={{ height: ROW_HEIGHT }}
                className={cn(
                  "flex items-center gap-2 rounded-[2px] px-2 text-xs",
                  isSelected
                    ? "bg-accent text-accent-foreground"
                    : "text-popover-foreground hover:bg-accent/50",
                )}
              >
                {item.display}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}
