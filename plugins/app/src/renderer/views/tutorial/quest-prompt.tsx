import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { Choice } from "./types"

/** Keyboard-navigable option list rendered in the composer slot.
 * Topics first, then "primary" (escape) options under a divider. */
export function QuestPrompt({
  options,
  onPick,
}: {
  options: Choice[]
  onPick: (id: string) => void
}) {
  // Topics first, then the "primary" (escape) options under a
  // divider. Array stays flat; the split is purely rendering.
  const firstPrimaryIdx = useMemo(
    () => options.findIndex(o => o.variant === "primary"),
    [options],
  )
  const hasEscapeSection = firstPrimaryIdx >= 0
  const topicCount = hasEscapeSection ? firstPrimaryIdx : options.length

  // Nothing highlighted until the user engages (key or hover);
  // the first ↓ lands on `initialTopicIdx`, not a wrap from -1.
  const initialTopicIdx = useMemo(() => {
    const idx = options.findIndex(o => o.variant !== "primary")
    return idx >= 0 ? idx : 0
  }, [options])
  const [highlightedIdx, setHighlightedIdx] = useState<number>(-1)
  useEffect(() => setHighlightedIdx(-1), [options])

  const containerRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    containerRef.current?.focus()
  }, [])

  const move = useCallback(
    (delta: number) => {
      setHighlightedIdx(idx => {
        const len = options.length
        if (len === 0) return idx
        if (idx < 0) return initialTopicIdx
        return (idx + delta + len) % len
      })
    },
    [options.length, initialTopicIdx],
  )

  const handleKey = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "ArrowDown" || (e.key === "j" && !e.metaKey && !e.ctrlKey)) {
        e.preventDefault()
        move(1)
        return
      }
      if (e.key === "ArrowUp" || (e.key === "k" && !e.metaKey && !e.ctrlKey)) {
        e.preventDefault()
        move(-1)
        return
      }
      if (e.key === "Enter") {
        e.preventDefault()
        if (highlightedIdx < 0) return // nothing engaged yet
        const opt = options[highlightedIdx]
        if (opt) onPick(opt.id)
        return
      }
      if (e.key === "Escape") {
        e.preventDefault()
        const exit = options.find(o => o.variant === "primary")
        if (exit) onPick(exit.id)
        return
      }
      // Numeric quick-pick only addresses the topic section.
      const n = Number(e.key)
      if (Number.isInteger(n) && n >= 1 && n <= topicCount) {
        e.preventDefault()
        const opt = options[n - 1]
        if (opt) onPick(opt.id)
      }
    },
    [highlightedIdx, options, onPick, move, topicCount],
  )

  const renderRow = (opt: Choice, i: number) => {
    const highlighted = i === highlightedIdx
    const primary = opt.variant === "primary"
    return (
      <li key={opt.id}>
        <button
          type="button"
          onMouseEnter={() => setHighlightedIdx(i)}
          onClick={() => onPick(opt.id)}
          className={
            "group flex w-full items-center gap-2.5 rounded-md border px-3 py-1.5 text-left text-[13px] font-medium " +
            (highlighted
              ? "border-ring/60 bg-accent/40 text-foreground"
              : "border-transparent text-foreground/85 hover:bg-accent/30") +
            (primary
              ? " text-muted-foreground/90 hover:text-foreground"
              : "")
          }
        >
          {!primary ? (
            <span
              className={
                "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-[10px] " +
                (highlighted
                  ? "bg-foreground/85 text-background"
                  : "border border-border/70 text-muted-foreground")
              }
              aria-hidden
            >
              {i + 1}
            </span>
          ) : null}
          <span className="min-w-0 flex-1 truncate">{opt.label}</span>
        </button>
      </li>
    )
  }

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={handleKey}
      className="flex flex-col gap-2 px-4 pt-2 pb-3 outline-none"
    >
      <ul className="flex flex-col gap-1">
        {options
          .slice(0, hasEscapeSection ? firstPrimaryIdx : options.length)
          .map((opt, i) => renderRow(opt, i))}
      </ul>
      {hasEscapeSection ? (
        <>
          <div aria-hidden className="my-1 border-t border-border/60" />
          <ul className="flex flex-col gap-1">
            {options
              .slice(firstPrimaryIdx)
              .map((opt, j) => renderRow(opt, firstPrimaryIdx + j))}
          </ul>
        </>
      ) : null}
    </div>
  )
}
