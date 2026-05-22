import { useEffect, useMemo, useRef, useState } from "react"
import { useDb, useEvents, useRpc } from "@zenbujs/core/react"
import {
  FitAddon,
  init as initGhostty,
  Terminal,
  type ITheme,
} from "ghostty-web"
import { cn } from "@/lib/utils"

let ghosttyReady: Promise<void> | null = null
function ensureGhostty() {
  if (!ghosttyReady) ghosttyReady = initGhostty()
  return ghosttyReady
}

export type TerminalPaneProps = {
  terminalId: string
  /** Matches ChatPane: when an adjacent left panel exists, skip rounding on
   * that side. */
  leftAdjacent?: boolean
  /** When the terminal pane has a neighbour on the right (e.g. the tab
   * list), skip the inner seam so the two surfaces sit flush. */
  rightAdjacent?: boolean
  className?: string
}

export function TerminalPane({
  terminalId,
  leftAdjacent = false,
  rightAdjacent = false,
  className,
}: TerminalPaneProps) {
  const rpc = useRpc()
  const events = useEvents()
  const containerRef = useRef<HTMLDivElement>(null)
  const paneRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const [error, setError] = useState<string | null>(null)
  const themePreference = useDb(root => root.app.settings.theme)

  useEffect(() => {
    const host = containerRef.current
    const pane = paneRef.current
    if (!host || !pane) return

    let disposed = false
    let unsubData: (() => void) | null = null
    let unsubExit: (() => void) | null = null
    let unsubInput: (() => void) | null = null
    let unsubResize: (() => void) | null = null

    const boot = async () => {
      try {
        await ensureGhostty()
      } catch (err) {
        if (!disposed) setError(String(err))
        return
      }
      if (disposed) return

      const term = new Terminal({
        cursorBlink: true,
        fontSize: 12,
        fontFamily:
          'ui-monospace, "SF Mono", Monaco, Menlo, "Cascadia Mono", Consolas, monospace',
        scrollback: 10000,
        theme: readThemeFromCss(pane),
      })
      const fit = new FitAddon()
      term.loadAddon(fit)
      term.open(host)

      // FitAddon measures `terminal.element` (== our host). If we call
      // fit() synchronously after open(), the host's clientWidth often
      // hasn't been laid out yet and we lock in a too-small grid that
      // never recovers. Defer to after layout.
      await new Promise<void>(r => requestAnimationFrame(() => r()))
      if (disposed) {
        term.dispose()
        return
      }
      try {
        fit.fit()
      } catch {}
      try {
        fit.observeResize()
      } catch {}

      termRef.current = term
      fitRef.current = fit

      let attached: { terminalId: string; cwd: string; replay: string }
      try {
        attached = await rpc.app.terminal.attach({
          terminalId,
          cols: term.cols,
          rows: term.rows,
        })
      } catch (err) {
        if (!disposed) setError(String(err))
        term.dispose()
        return
      }
      if (disposed) {
        term.dispose()
        return
      }

      if (attached.replay) term.write(attached.replay)

      unsubData = events.app.terminalData.subscribe(({ terminalId: id, data }) => {
        if (id !== attached.terminalId) return
        term.write(data)
      })

      unsubExit = events.app.terminalExit.subscribe(({ terminalId: id }) => {
        if (id !== attached.terminalId) return
        term.write("\r\n\x1b[2m[process exited]\x1b[0m\r\n")
      })

      const inputDisp = term.onData(data => {
        void rpc.app.terminal
          .write({ terminalId: attached.terminalId, data })
          .catch(() => {})
      })
      unsubInput = () => inputDisp.dispose()

      const resizeDisp = term.onResize(({ cols, rows }) => {
        void rpc.app.terminal
          .resize({ terminalId: attached.terminalId, cols, rows })
          .catch(() => {})
      })
      unsubResize = () => resizeDisp.dispose()
    }

    void boot()

    return () => {
      disposed = true
      unsubData?.()
      unsubExit?.()
      unsubInput?.()
      unsubResize?.()
      try {
        termRef.current?.dispose()
      } catch {}
      termRef.current = null
      fitRef.current = null
    }
  }, [rpc, events, terminalId])

  // Re-apply theme whenever the user toggles light/dark/system, or the OS
  // pref changes underneath "system". `themePreference` participates in the
  // dep array; the rAF gives the `.dark` class toggle a chance to land
  // before we read computed styles.
  useEffect(() => {
    const term = termRef.current
    const pane = paneRef.current
    if (!term || !pane) return
    let cancelled = false
    const apply = () => {
      if (cancelled) return
      const theme = readThemeFromCss(pane)
      const renderer = term.renderer
      if (renderer) renderer.setTheme(theme)
    }
    const raf = requestAnimationFrame(apply)
    const media = window.matchMedia("(prefers-color-scheme: dark)")
    media.addEventListener("change", apply)
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      media.removeEventListener("change", apply)
    }
  }, [themePreference])

  // We keep the bottom border so the shell's bottom edge stays visible;
  // the outer `overflow-hidden rounded-[10px]` clips it into the outer
  // curve. What we drop is the bottom corner rounding (see
  // `terminalCornerRoundingClass`) so we don't stack on top of the shell.
  const borderClass = rightAdjacent ? "border-b" : "border-b border-r"
  const cornerClass = useMemo(
    () => terminalCornerRoundingClass({ leftAdjacent, rightAdjacent }),
    [leftAdjacent, rightAdjacent],
  )

  return (
    <div
      ref={paneRef}
      className={cn(
        // Drop `bg-clip-padding` so the always-on `border-b` (and
        // optional `border-r`) composite against this pane's own
        // `bg-background` instead of the darker parent (`bg-muted`).
        // Matches the rendering of every other border in the app.
        "flex h-full min-h-0 w-full flex-col overflow-hidden bg-background pt-2 pl-2 pr-2",
        borderClass,
        cornerClass,
        className,
      )}
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      onMouseDown={() => {
        termRef.current?.focus()
      }}
    >
      {error ? (
        <div className="p-3 text-[12px] text-red-400">{error}</div>
      ) : (
        <div ref={containerRef} className="min-h-0 flex-1" />
      )}
    </div>
  )
}

function terminalCornerRoundingClass({
  leftAdjacent,
  rightAdjacent,
}: {
  leftAdjacent: boolean
  rightAdjacent: boolean
}): string {
  // No bottom rounding ever: the outer app shell owns the bottom corners.
  // We do still keep the prop signature so callers can declare their intent
  // — it's used by `borderClass` above for the right-side seam.
  void leftAdjacent
  void rightAdjacent
  return ""
}

/** Read the active CSS theme variables from `host`'s computed style and
 * return an `ITheme` for ghostty-web. We intentionally only sync the bits
 * that have a clear analogue in our design system (background, foreground,
 * cursor, selection) and let ghostty pick sensible defaults for the rest of
 * the ANSI palette. */
function readThemeFromCss(host: HTMLElement): ITheme {
  const style = getComputedStyle(host)
  const bg = style.getPropertyValue("--background").trim() || "#0b0b0b"
  const fg = style.getPropertyValue("--foreground").trim() || "#e5e5e5"
  const selectionBg = style.getPropertyValue("--ring").trim() || fg
  return {
    background: bg,
    foreground: fg,
    cursor: fg,
    cursorAccent: bg,
    selectionBackground: selectionBg,
    selectionForeground: fg,
  }
}
