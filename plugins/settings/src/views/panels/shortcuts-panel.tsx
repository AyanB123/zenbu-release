import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react"
import { useRpc, useDb } from "@zenbujs/core/react"
import { Input } from "@zenbu/ui/input"
import { cn } from "@zenbu/ui/utils"

/**
 * VSCode-style shortcuts settings panel.
 *
 *   - Pulls the full list via `rpc.core.shortcuts.list()` once and then
 *     keeps it in sync by re-subscribing whenever `core.shortcuts` (the
 *     user overrides) change in the DB. New shortcut *definitions* (a
 *     plugin registers more) come through `events.core.shortcuts.changed`
 *     too, but the DB-change refresh already covers the common case
 *     (rebind / reset).
 *   - Fuzzy-ish substring filter on `name`, `id`, and `description`.
 *   - Per-row "Rebind" opens an in-place capture overlay that records
 *     the very next non-modifier keydown into the binding and calls
 *     `setBinding`. ESC cancels the capture without changes; Backspace
 *     during capture clears the binding (sets it to null = disabled).
 */
type ShortcutBinding = {
  key?: string
  code?: string
  meta?: boolean
  control?: boolean
  alt?: boolean
  shift?: boolean
}

type Listing = {
  id: string
  name: string
  description?: string
  category?: string
  defaultBindings: ShortcutBinding[]
  binding: ShortcutBinding | null
  isCustom: boolean
  isDisabled: boolean
}

const IS_MAC =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.platform)

function formatModifier(b: ShortcutBinding): string[] {
  const parts: string[] = []
  if (b.control) parts.push(IS_MAC ? "⌃" : "Ctrl")
  if (b.alt) parts.push(IS_MAC ? "⌥" : "Alt")
  if (b.shift) parts.push(IS_MAC ? "⇧" : "Shift")
  if (b.meta) parts.push(IS_MAC ? "⌘" : "Win")
  return parts
}

function formatKey(b: ShortcutBinding): string {
  if (!b.key && !b.code) return ""
  const k = b.key ?? ""
  // Pretty-print a few special keys; otherwise upper-case the literal.
  const map: Record<string, string> = {
    arrowleft: "←",
    arrowright: "→",
    arrowup: "↑",
    arrowdown: "↓",
    enter: "↵",
    backspace: "⌫",
    delete: "⌦",
    tab: "⇥",
    escape: "Esc",
    " ": "Space",
  }
  const lower = k.toLowerCase()
  return map[lower] ?? (k.length === 1 ? k.toUpperCase() : k)
}

function BindingPill({ binding }: { binding: ShortcutBinding | null }) {
  if (!binding) {
    return (
      <span className="text-[11px] text-muted-foreground">Disabled</span>
    )
  }
  const segments = [...formatModifier(binding), formatKey(binding)].filter(
    Boolean,
  )
  return (
    <span className="inline-flex items-center gap-0.5">
      {segments.map((seg, i) => (
        <kbd
          key={i}
          className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-foreground"
        >
          {seg}
        </kbd>
      ))}
    </span>
  )
}

function BindingCapture({
  onCommit,
  onCancel,
}: {
  onCommit: (binding: ShortcutBinding | null) => void
  onCancel: () => void
}) {
  // Capture in a ref-scoped listener so even keydowns that get
  // preventDefaulted globally (by our own prelude!) still land here —
  // the prelude only acts on the entrypoint window; this hook is on
  // the same window so order is irrelevant, but capture phase is
  // important so we win over child handlers.
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      // Ignore pure modifier presses so the user can chord at their own
      // pace (Cmd held → then P).
      const k = e.key
      if (k === "Meta" || k === "Control" || k === "Alt" || k === "Shift")
        return
      e.preventDefault()
      e.stopPropagation()
      if (k === "Escape") {
        onCancel()
        return
      }
      if (k === "Backspace") {
        onCommit(null)
        return
      }
      onCommit({
        key: k,
        code: e.code,
        meta: e.metaKey,
        control: e.ctrlKey,
        alt: e.altKey,
        shift: e.shiftKey,
      })
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [onCommit, onCancel])
  return (
    <div
      ref={ref}
      tabIndex={-1}
      className="inline-flex items-center gap-2 rounded bg-muted px-2 py-1 text-[11px] text-muted-foreground outline-none"
    >
      <span className="size-1.5 animate-pulse rounded-full bg-foreground/60" />
      <span>Press shortcut…</span>
    </div>
  )
}

export function ShortcutsPanel() {
  const rpc = useRpc()
  // `useDb` on the overrides record is the cheap way to re-trigger a
  // refresh whenever someone changes a binding (including ourselves).
  // The actual listing has to come through RPC because plugin defs
  // only exist in main-process memory.
  const overrides = useDb((root) => root.core?.shortcuts ?? {})
  const [listings, setListings] = useState<Listing[]>([])
  const [filter, setFilter] = useState("")
  const [capturingId, setCapturingId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void rpc.core.shortcuts.list().then((rows) => {
      if (!cancelled) setListings(rows as Listing[])
    })
    return () => {
      cancelled = true
    }
  }, [rpc, overrides])

  const grouped = useMemo(() => {
    const q = filter.trim().toLowerCase()
    const filtered = q
      ? listings.filter((l) => {
          const hay =
            `${l.name} ${l.id} ${l.description ?? ""}`.toLowerCase()
          return hay.includes(q)
        })
      : listings
    const byCat = new Map<string, Listing[]>()
    for (const l of filtered) {
      const cat = l.category ?? "Other"
      const arr = byCat.get(cat) ?? []
      arr.push(l)
      byCat.set(cat, arr)
    }
    return [...byCat.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [listings, filter])

  const setBinding = async (id: string, binding: ShortcutBinding | null) => {
    setCapturingId(null)
    await rpc.core.shortcuts.setBinding({ id, binding })
  }
  const reset = async (id: string) => {
    await rpc.core.shortcuts.resetBinding({ id })
  }

  return (
    // `h-full` only — no `max-h-[60vh]`/`min-h-[400px]`. Those were
    // tuned for the old Settings dialog (constrained modal height).
    // In the pane view we get a real flex parent that grows with the
    // tab, so we just fill it; the inner div below owns the scroll.
    <div className="flex h-full min-h-0 flex-col gap-3">
      <Input
        autoFocus
        value={filter}
        placeholder="Search shortcuts…"
        onChange={(e: ChangeEvent<HTMLInputElement>) => setFilter(e.target.value)}
        className="h-8 text-[12px]"
      />
      <div className="-mr-2 flex-1 overflow-y-auto pr-2">
        {grouped.length === 0 ? (
          <div className="flex h-full items-center justify-center text-[12px] text-muted-foreground">
            No shortcuts match "{filter}".
          </div>
        ) : (
          grouped.map(([cat, rows]) => (
            <div key={cat} className="mb-4">
              <div className="mb-1 text-[11px] font-medium text-muted-foreground">
                {cat}
              </div>
              <div>
                {rows.map((row, i) => (
                  <div
                    key={row.id}
                    className={cn(
                      "flex items-center gap-3 px-3 py-2",
                      i !== rows.length - 1 && "border-b border-border",
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[12px] font-medium text-foreground">
                          {row.name}
                        </span>
                        {row.isCustom && (
                          <span className="text-[10px] text-muted-foreground">
                            custom
                          </span>
                        )}
                      </div>
                      <div className="truncate text-[10px] text-muted-foreground">
                        {row.id}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {capturingId === row.id ? (
                        <BindingCapture
                          onCommit={(b) => setBinding(row.id, b)}
                          onCancel={() => setCapturingId(null)}
                        />
                      ) : (
                        <BindingPill binding={row.binding} />
                      )}
                      <button
                        type="button"
                        className="h-6 rounded px-2 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
                        onClick={() =>
                          setCapturingId((c) =>
                            c === row.id ? null : row.id,
                          )
                        }
                      >
                        {capturingId === row.id ? "Cancel" : "Rebind"}
                      </button>
                      {row.isCustom && (
                        <button
                          type="button"
                          className="h-6 rounded px-2 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
                          onClick={() => reset(row.id)}
                        >
                          Reset
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
