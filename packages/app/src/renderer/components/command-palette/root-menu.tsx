import { useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { PaletteShell } from "./palette-shell"
import type { Command } from "./types"
import { useArrowNav } from "./use-arrow-nav"

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

  const handleArrow = useArrowNav(filtered.length, setSelected)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" })
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
      <div className="max-h-[360px] overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="px-3 py-6 text-center text-[12px] text-muted-foreground">
            No commands.
          </div>
        ) : (
          filtered.map((cmd, i) => (
            <Button
              key={cmd.id}
              ref={i === selected ? selectedRef : null}
              type="button"
              variant="ghost"
              onMouseDown={e => {
                e.preventDefault()
                onActivate(cmd)
              }}
              onMouseMove={() => setSelected(i)}
              className={cn(
                "h-auto w-full justify-between gap-3 rounded-none px-3 py-1.5 text-left text-[13px] font-normal text-popover-foreground transition-none",
                i === selected && "bg-accent text-accent-foreground",
              )}
            >
              <span className="flex items-center gap-2 truncate">
                {cmd.icon && (
                  <span
                    aria-hidden
                    className="inline-flex size-4 shrink-0 items-center justify-center text-muted-foreground"
                  >
                    {cmd.icon}
                  </span>
                )}
                <span className="truncate">{cmd.label}</span>
              </span>
              {cmd.hint && (
                <span className="shrink-0 truncate text-[12px] text-muted-foreground">
                  {cmd.hint}
                </span>
              )}
            </Button>
          ))
        )}
      </div>
    </PaletteShell>
  )
}
