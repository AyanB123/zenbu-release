import { useLayoutEffect, useEffect, useMemo, useRef, useState } from "react"
import { Input } from "@zenbu/ui/input"
import { cn } from "@/lib/utils"
import { ensureRowInView } from "@/lib/ensure-row-in-view"
import { useHoverIntent } from "@/lib/hooks/use-hover-intent"
import { PaletteShell } from "./palette-shell"
import type { Command } from "./types"
import { useArrowNav } from "./use-arrow-nav"
// Rows render as plain <button>s now — see the comment above the row
// loop. `Button` from @zenbu/ui isn't imported anymore.

export type RootMenuProps = {
  commands: Command[]
  onActivate: (command: Command) => void
  onClose: () => void
}

export function RootMenu({ commands, onActivate, onClose }: RootMenuProps) {
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const selectedRef = useRef<HTMLButtonElement>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const hover = useHoverIntent()

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return commands
    return commands.filter(
      c =>
        c.label.toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q) ||
        (c.hint?.toLowerCase().includes(q) ?? false),
    )
  }, [commands, query])

  useEffect(() => {
    if (selected >= filtered.length) setSelected(0)
  }, [filtered, selected])

  // Wrap setSelected so any keyboard nav also flips hover intent
  // off — keeps a stale cursor position from re-claiming the
  // selection on the next render.
  const setSelectedFromKeyboard = (n: number | ((s: number) => number)) => {
    hover.resetToKeyboard()
    setSelected(n)
  }
  const handleArrow = useArrowNav(filtered.length, setSelectedFromKeyboard)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])
  useLayoutEffect(() => {
    const scroller = scrollerRef.current
    const el = selectedRef.current
    if (scroller && el) ensureRowInView(scroller, el)
  }, [selected])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault()
      onClose()
      return
    }
    if (handleArrow(e)) return
    if (e.key === "Enter") {
      e.preventDefault()
      const cmd = filtered[selected]
      if (cmd) onActivate(cmd)
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
          placeholder="Run a command…"
          spellCheck={false}
          className="w-full rounded-none border-0 bg-transparent px-3 py-2 text-[13px] shadow-none focus-visible:ring-0"
        />
      }
    >
      <div ref={scrollerRef} className="max-h-[360px] overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="px-3 py-6 text-center text-[12px] text-muted-foreground">
            No commands.
          </div>
        ) : (
          // Label-only rows. Icons and right-aligned hints both got
          // dropped from the palette UX: `cmd.icon` no longer exists
          // on the type, and `cmd.hint` is kept only as fuzzy-filter
          // index text (a user typing "\u2318P" still finds "Toggle
          // Command Palette"). Selection is the only background — a
          // plain <button>, NOT a `ghost`-variant Button, so the
          // ghost variant's `hover:bg-accent` can't paint a phantom
          // second selection under the cursor.
          filtered.map((cmd, i) => (
            <button
              key={cmd.id}
              ref={i === selected ? selectedRef : null}
              type="button"
              onMouseDown={e => {
                e.preventDefault()
                onActivate(cmd)
              }}
              onMouseMove={() => {
                if (hover.isActive()) setSelected(i)
              }}
              className={cn(
                "flex h-auto w-full items-center justify-start gap-2 rounded-none border-0 bg-transparent px-3 py-1.5 text-left text-[13px] font-normal text-popover-foreground outline-none transition-none focus:outline-none",
                i === selected && "bg-accent text-accent-foreground",
              )}
            >
              <span className="truncate">{cmd.label}</span>
            </button>
          ))
        )}
      </div>
    </PaletteShell>
  )
}
