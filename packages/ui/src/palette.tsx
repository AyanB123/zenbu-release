import {
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { Input } from "./input"
import { cn } from "./utils"
// NOTE: previously imported `Button` for `PaletteRow` — it now renders
// a plain <button> so the shadcn `ghost` variant's `hover:bg-accent`
// can't paint a phantom selection under the cursor. See the comment in
// `PaletteRow` for the reasoning.

/* -------------------------------------------------------------------------- */
/*                                 Palette                                    */
/* -------------------------------------------------------------------------- */
/**
 * Generic command-palette-style overlay. Provides the chrome (centered
 * card, search input, scrollable list, keyboard nav, escape / click-out
 * close, scroll-into-view) so callers only have to bring data + a row
 * renderer.
 *
 * Shared so any plugin can drop in a Cmd+P-flavored picker without
 * reimplementing the boilerplate.
 */

export type PaletteShellProps = {
  header?: ReactNode
  footer?: ReactNode
  children: ReactNode
}

export function PaletteShell({ header, footer, children }: PaletteShellProps) {
  return (
    <div
      onClick={e => e.stopPropagation()}
      className="flex w-[560px] max-w-[90vw] flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl"
    >
      {header && <div className="shrink-0 border-b border-border">{header}</div>}
      <div className="min-h-0 flex-1">{children}</div>
      {footer && (
        <div className="shrink-0 border-t border-border bg-muted/70 px-3 py-2 text-[11px] text-muted-foreground">
          {footer}
        </div>
      )}
    </div>
  )
}

export type PaletteRowRenderArgs<T> = {
  item: T
  index: number
  isSelected: boolean
  /** Apply to the row root so the palette can scroll it into view. */
  rowRef: Ref<HTMLButtonElement>
  /** Hover-driven selection (gated so it only fires after the user
   * actually moves the mouse — keyboard nav isn't clobbered by a
   * mouse hovering the list). */
  onMouseMove: () => void
  /** Activate the row. Wire this to `onMouseDown` so the input
   * doesn't blur+steal the click. */
  onActivate: () => void
}

export type PaletteProps<T> = {
  open: boolean
  onClose: () => void
  items: readonly T[]
  onActivate: (item: T) => void
  getKey: (item: T, index: number) => string
  /** String used by the built-in client-side filter when a query is
   * present. Return null to opt out (item shows regardless). */
  getFilterText?: (item: T) => string | null
  /** Render one row. Must spread the provided ref / handlers. */
  renderRow: (args: PaletteRowRenderArgs<T>) => ReactNode
  placeholder?: string
  emptyMessage?: ReactNode
  /** Selected row when the palette opens / clears its query.
   * VSCode Cmd+P starts at index 1 so the previously-opened file is
   * one Enter away — callers can pass `1` to reproduce that. */
  initialSelectedIndex?: number
}

export function Palette<T>({
  open,
  onClose,
  items,
  onActivate,
  getKey,
  getFilterText,
  renderRow,
  placeholder,
  emptyMessage,
  initialSelectedIndex = 0,
}: PaletteProps<T>) {
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-[1000] flex items-start justify-center pt-[12vh]"
      onClick={onClose}
    >
      <PaletteBody
        items={items}
        onActivate={onActivate}
        onClose={onClose}
        getKey={getKey}
        getFilterText={getFilterText}
        renderRow={renderRow}
        placeholder={placeholder}
        emptyMessage={emptyMessage}
        initialSelectedIndex={initialSelectedIndex}
      />
    </div>
  )
}

function PaletteBody<T>({
  items,
  onActivate,
  onClose,
  getKey,
  getFilterText,
  renderRow,
  placeholder,
  emptyMessage,
  initialSelectedIndex,
}: Omit<PaletteProps<T>, "open">) {
  const [query, setQuery] = useState("")
  const initial = Math.max(
    0,
    Math.min(initialSelectedIndex ?? 0, Math.max(0, items.length - 1)),
  )
  const [selected, setSelected] = useState(initial)
  const inputRef = useRef<HTMLInputElement>(null)
  const selectedRowRef = useRef<HTMLButtonElement>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const hover = useHoverIntent()

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q || !getFilterText) return items
    return items.filter(item => {
      const t = getFilterText(item)
      return t ? t.toLowerCase().includes(q) : true
    })
  }, [items, query, getFilterText])

  // Reset selection when the filter narrows past it, or when the
  // query is cleared (back to the caller-provided initial index).
  useEffect(() => {
    if (!query) {
      setSelected(
        Math.max(
          0,
          Math.min(initialSelectedIndex ?? 0, Math.max(0, filtered.length - 1)),
        ),
      )
    } else if (selected >= filtered.length) {
      setSelected(0)
    }
  }, [filtered.length, query, initialSelectedIndex])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useLayoutEffect(() => {
    const scroller = scrollerRef.current
    const el = selectedRowRef.current
    if (scroller && el) ensureRowInView(scroller, el)
  }, [selected])

  const setSelectedFromKeyboard = useCallback(
    (n: number | ((s: number) => number)) => {
      hover.resetToKeyboard()
      setSelected(n)
    },
    [hover],
  )

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault()
      onClose()
      return
    }
    if (handleArrow(e, filtered.length, setSelectedFromKeyboard)) return
    if (e.key === "Enter") {
      e.preventDefault()
      const item = filtered[selected]
      if (item !== undefined) onActivate(item)
    }
  }

  return (
    <PaletteShell
      header={
        <Input
          ref={inputRef}
          value={query}
          onChange={e => {
            setQuery(e.target.value)
            setSelected(0)
          }}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          spellCheck={false}
          className="w-full rounded-none border-0 bg-transparent px-3 py-2 text-[13px] shadow-none focus-visible:ring-0"
        />
      }
    >
      <div ref={scrollerRef} className="max-h-[360px] overflow-y-auto">
        {filtered.length === 0 ? (
          emptyMessage == null ? null : (
            <div className="px-3 py-6 text-center text-[12px] text-muted-foreground">
              {emptyMessage}
            </div>
          )
        ) : (
          filtered.map((item, i) =>
            renderRow({
              item,
              index: i,
              isSelected: i === selected,
              rowRef: i === selected ? selectedRowRef : noopRef,
              onMouseMove: () => {
                if (hover.isActive()) setSelected(i)
              },
              onActivate: () => onActivate(item),
            }),
          )
        )}
      </div>
    </PaletteShell>
  )
}

/**
 * Convenience row component matching the Cmd+P aesthetic: ghost
 * button with a selected/hover state. Callers can use this or
 * render their own from scratch.
 */
export type PaletteRowProps = {
  isSelected: boolean
  rowRef: Ref<HTMLButtonElement>
  onMouseMove: () => void
  onActivate: () => void
  children: ReactNode
  className?: string
}

export function PaletteRow({
  isSelected,
  rowRef,
  onMouseMove,
  onActivate,
  children,
  className,
}: PaletteRowProps) {
  // Plain <button>, NOT a shadcn Button with the `ghost` variant — the
  // ghost variant adds its own `hover:bg-accent`, which paints a second
  // "selected-looking" row under the cursor whenever the cursor sits
  // over the palette (most of the time, since the palette opens right
  // under it). Selection is purely keyboard-driven here: `isSelected`
  // is the only background highlight, and hover *moves* the selection
  // (via `onMouseMove` + the `useHoverIntent` gate) but doesn't paint
  // its own.
  return (
    <button
      ref={rowRef}
      type="button"
      onMouseDown={e => {
        e.preventDefault()
        onActivate()
      }}
      onMouseMove={onMouseMove}
      className={cn(
        "flex h-auto w-full items-center justify-start gap-3 rounded-none border-0 bg-transparent px-3 py-1.5 text-left text-[13px] font-normal text-popover-foreground outline-none transition-none focus:outline-none",
        isSelected && "bg-accent text-accent-foreground",
        className,
      )}
    >
      {children}
    </button>
  )
}

/* -------------------------------------------------------------------------- */
/*                                Internals                                   */
/* -------------------------------------------------------------------------- */

const noopRef: Ref<HTMLButtonElement> = () => {}

const HALF_PAGE = 8

function handleArrow(
  e: React.KeyboardEvent,
  length: number,
  setSelected: (n: number | ((s: number) => number)) => void,
): boolean {
  const plainCtrl = e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey
  if (e.key === "ArrowDown" || (plainCtrl && (e.key === "n" || e.key === "N"))) {
    e.preventDefault()
    if (length > 0) setSelected(s => (s + 1) % length)
    return true
  }
  if (e.key === "ArrowUp" || (plainCtrl && (e.key === "p" || e.key === "P"))) {
    e.preventDefault()
    if (length > 0) setSelected(s => (s - 1 + length) % length)
    return true
  }
  if (plainCtrl && (e.key === "d" || e.key === "D")) {
    e.preventDefault()
    if (length > 0) setSelected(s => Math.min(length - 1, s + HALF_PAGE))
    return true
  }
  if (plainCtrl && (e.key === "u" || e.key === "U")) {
    e.preventDefault()
    if (length > 0) setSelected(s => Math.max(0, s - HALF_PAGE))
    return true
  }
  return false
}

/**
 * Gate hover-driven selection on **actual** mouse movement.
 *
 * The earlier version listened on `window` for `pointermove`, which
 * fires from sub-pixel layout shifts the moment the palette opens
 * (the input mounts, the page reflows under a stationary cursor —
 * Chromium synthesises a pointermove). That flipped the gate to
 * "hover-active" before the user had touched the mouse, so the row
 * under the cursor immediately stole keyboard selection.
 *
 * The fix: only count moves that change the cursor's screen position.
 * We track the last (clientX, clientY) and ignore events that report
 * the same coordinates — those are the synthetic reflow pings. Real
 * movement always produces new coordinates, so legitimate hover-nav
 * still works the first frame the user actually moves the mouse.
 */
function useHoverIntent() {
  const ref = useRef(false)
  useEffect(() => {
    ref.current = false
    let lastX: number | null = null
    let lastY: number | null = null
    const onMove = (e: PointerEvent) => {
      if (lastX !== null && e.clientX === lastX && e.clientY === lastY) {
        // Same coordinates as the previous event — almost certainly a
        // layout-shift synthetic move, not the user wiggling the mouse.
        return
      }
      lastX = e.clientX
      lastY = e.clientY
      ref.current = true
    }
    window.addEventListener("pointermove", onMove)
    return () => window.removeEventListener("pointermove", onMove)
  }, [])
  return useMemo(
    () => ({
      isActive: () => ref.current,
      resetToKeyboard: () => {
        ref.current = false
      },
    }),
    [],
  )
}

function ensureRowInView(container: HTMLElement, row: HTMLElement): void {
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
