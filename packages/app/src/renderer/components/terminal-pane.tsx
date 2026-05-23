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
  /** Whether this pane is the currently visible/active terminal in its
   * parent. Used to drive auto-focus and to re-`fit()` the grid when the
   * pane becomes visible (e.g. tab switch). The pane itself stays
   * mounted either way — switching is a visibility flip, not a
   * mount/unmount — so the underlying `Terminal` keeps its scrollback. */
  isActive?: boolean
  /** Optional registry hook. When provided, the pane registers a
   * `clear()` callback keyed by `terminalId` so the parent (header
   * menu, Cmd+K, etc.) can wipe this terminal's scrollback without
   * reaching into the xterm directly. Returns the unregister fn. */
  registerClear?: (terminalId: string, clear: () => void) => () => void
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
  isActive = true,
  registerClear,
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
  /** Boot completed: term is open(), attached, replayed, and the event
   * subscriptions are live. Used to gate `isActive`-driven focus/fit so
   * we don't try to operate on a half-initialized terminal. */
  const readyRef = useRef(false)
  const [, forceRender] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const themePreference = useDb(root => root.app.settings.theme)

  // Track the latest `isActive` so the async boot can check it right
  // after attach without needing to be re-run when it flips.
  const isActiveRef = useRef(isActive)
  isActiveRef.current = isActive

  useEffect(() => {
    const host = containerRef.current
    const pane = paneRef.current
    if (!host || !pane) return

    let disposed = false
    const unsubs: Array<() => void> = []
    let term: Terminal | null = null

    const cleanup = () => {
      disposed = true
      readyRef.current = false
      // Unsubscribe everything that was registered up to this point.
      // We snapshot+splice to avoid double-calls if cleanup is invoked
      // more than once (it shouldn't be, but be defensive).
      for (const fn of unsubs.splice(0)) {
        try {
          fn()
        } catch {}
      }
      try {
        term?.dispose()
      } catch {}
      term = null
      termRef.current = null
      fitRef.current = null
    }

    const boot = async () => {
      try {
        await ensureGhostty()
      } catch (err) {
        if (!disposed) setError(String(err))
        return
      }
      if (disposed) return

      term = new Terminal({
        // Only blink when actually focused — otherwise the cursor reads
        // as "focused" even when keystrokes aren't reaching the term
        // (which has been the dominant "is this thing on?" UX bug).
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
        try { term.dispose() } catch {}
        term = null
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

      // Set up event subscriptions BEFORE issuing `attach`. Otherwise
      // any data emitted between the buffer snapshot the server takes
      // inside `attach` and the moment we register `terminalData` is
      // silently dropped on the floor. We capture `terminalId` from
      // the closure (it's a useEffect dep) so the filter matches what
      // we're about to attach to.
      //
      // To avoid the *other* side of the race — events arriving
      // during the attach round-trip whose data is *also* included
      // in the replay (which would double-write whatever chunk was
      // in flight, and is the root cause of "output gets bungled
      // when switching workspaces") — we queue events until attach
      // returns, then dedupe by `seq` against `attached.lastSeq`.
      const wantedId = terminalId
      const localTerm = term
      let attachDone = false
      let lastWrittenSeq = 0
      const pending: Array<{ seq: number; data: string }> = []
      const onData = events.app.terminalData.subscribe(
        ({ terminalId: id, data, seq }) => {
          if (id !== wantedId) return
          if (!attachDone) {
            pending.push({ seq, data })
            return
          }
          if (seq <= lastWrittenSeq) return
          lastWrittenSeq = seq
          localTerm.write(data)
        },
      )
      unsubs.push(onData)

      const onExit = events.app.terminalExit.subscribe(({ terminalId: id }) => {
        if (id !== wantedId) return
        localTerm.write("\r\n\x1b[2m[process exited]\x1b[0m\r\n")
      })
      unsubs.push(onExit)

      let attached: {
        terminalId: string
        cwd: string
        replay: string
        lastSeq: number
      }
      try {
        attached = await rpc.app.terminal.attach({
          terminalId: wantedId,
          cols: localTerm.cols,
          rows: localTerm.rows,
        })
      } catch (err) {
        if (!disposed) setError(String(err))
        try { localTerm.dispose() } catch {}
        term = null
        return
      }
      if (disposed) {
        try { localTerm.dispose() } catch {}
        term = null
        return
      }

      // Replay first — it's the buffered tail up through
      // `attached.lastSeq`. Then drain any events we queued during
      // the await, dropping the prefix that the replay already
      // covered. Going forward, the live subscription handler runs
      // its own seq check against `lastWrittenSeq`.
      if (attached.replay) localTerm.write(attached.replay)
      lastWrittenSeq = attached.lastSeq
      for (const ev of pending) {
        if (ev.seq <= lastWrittenSeq) continue
        lastWrittenSeq = ev.seq
        localTerm.write(ev.data)
      }
      pending.length = 0
      attachDone = true

      const inputDisp = localTerm.onData(data => {
        void rpc.app.terminal
          .write({ terminalId: wantedId, data })
          .catch(() => {})
      })
      unsubs.push(() => inputDisp.dispose())

      const resizeDisp = localTerm.onResize(({ cols, rows }) => {
        void rpc.app.terminal
          .resize({ terminalId: wantedId, cols, rows })
          .catch(() => {})
      })
      unsubs.push(() => resizeDisp.dispose())

      readyRef.current = true

      // Hand the parent a clear() handle for this terminal id so the
      // header menu / Cmd+K can wipe scrollback without grabbing the
      // xterm ref directly.
      if (registerClear) {
        const unregister = registerClear(wantedId, () => {
          try { localTerm.clear() } catch {}
        })
        unsubs.push(unregister)
      }

      // Auto-focus if the pane is the active one when boot finishes.
      // Focus is a no-op if the iframe doesn't have keyboard focus,
      // but it still flips the term's internal focused state so the
      // moment the iframe gets focus, typing lands here.
      if (isActiveRef.current) {
        try { localTerm.focus() } catch {}
      }
      // Nudge a render so any code observing termRef.current via state
      // (e.g. theme effect) re-runs with the now-live term.
      forceRender(n => n + 1)
    }

    void boot()

    return cleanup
  }, [rpc, events, terminalId])

  // When this pane becomes the active tab, re-fit (the container's
  // measured size may have changed while we were hidden) and pull
  // focus. Runs only after boot finishes so the term is real.
  useEffect(() => {
    if (!isActive) return
    if (!readyRef.current) return
    const term = termRef.current
    const fit = fitRef.current
    if (!term) return
    // rAF so we measure after the parent's display flip has laid out.
    const raf = requestAnimationFrame(() => {
      try { fit?.fit() } catch {}
      try { term.focus() } catch {}
    })
    return () => cancelAnimationFrame(raf)
  }, [isActive])

  // The parent renderer focuses *this iframe* (via `iframeEl.focus()`)
  // when the bottom panel opens. That fires a `focus` event on this
  // window — we catch it and direct the focus to the term so
  // keystrokes land on the prompt instead of the iframe's `<body>`.
  //
  // This is the deterministic side of the cross-frame focus path:
  // parent moves keyboard focus *onto* the iframe (which doesn't
  // need user activation), and the iframe routes focus *within*
  // itself to the right element (which doesn't need user activation
  // either, because the iframe already owns the focus by the time
  // this listener fires).
  //
  // Gated by `isActive` so a hidden TerminalPane (different tab in
  // the same scope) doesn't steal focus from the visible one.
  useEffect(() => {
    if (!isActive) return
    const onWindowFocus = () => {
      const term = termRef.current
      if (!term) return
      try { term.focus() } catch {}
    }
    window.addEventListener("focus", onWindowFocus)
    return () => window.removeEventListener("focus", onWindowFocus)
  }, [isActive])

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
        // `caretColor: transparent` kills the browser's native text
        // caret. Ghostty-web turns this host element into a
        // `contenteditable` for input handling, which would
        // otherwise paint a blinking caret parked at the top-left
        // of the host (the contenteditable's logical position-0).
        // The real cursor lives in the canvas xterm draws into, so
        // the native caret is pure noise.
        <div
          ref={containerRef}
          className="min-h-0 flex-1"
          style={{ caretColor: "transparent" }}
        />
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
