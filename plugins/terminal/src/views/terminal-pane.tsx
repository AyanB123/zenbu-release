import { useEffect, useMemo, useRef, useState } from "react"
import { useDb, useEvents, useRpc } from "@zenbujs/core/react"
import {
  FitAddon,
  init as initGhostty,
  Terminal,
  type ITheme,
} from "ghostty-web"
import { cn } from "@zenbu/ui/utils"

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

      // Boot started the render loop unconditionally. If we're hidden,
      // pause it right away so we don't tick at 60fps for nothing.
      if (!isActiveRef.current) pauseRenderLoop(localTerm)

      // Hand the parent a clear() handle for this terminal id so the
      // header menu / Cmd+K can wipe scrollback without grabbing the
      // xterm ref directly.
      if (registerClear) {
        const unregister = registerClear(wantedId, () => {
          try { localTerm.clear() } catch {}
        })
        unsubs.push(unregister)
      }

      // DO NOT speculatively `localTerm.focus()` on boot.
      //
      // In iframe mode this was a free no-op: the iframe didn't have
      // keyboard focus yet, so the call just flipped the term's
      // internal focused-state flag for when the parent later pushed
      // focus onto the iframe. In component mode there is no
      // intermediate iframe — ghostty's container IS a
      // contenteditable in the host's own document. Calling
      // `focus()` here at boot, while the bottom panel is still
      // collapsed (Allotment `visible=false`), makes Chromium try
      // to scroll-into-view a focused contenteditable inside a
      // 0-height pane. The browser ends up shifting an ancestor a
      // few pixels up to maximise the target's visibility, which
      // clips the chat pane's `border-t` behind the title bar
      // until the next layout pass (e.g. the user opening the
      // bottom panel). See the `[class*="splitView"] { overflow:
      // clip }` block in the host's `main.css` for the iframe-era
      // version of this bug — the new manifestation lives one
      // ancestor higher because the focus target isn't an iframe
      // anymore.
      //
      // The host's `BottomPanel` already drives a parent→child
      // focus push when the panel actually opens (it focuses the
      // pane wrapper, whose `focus` handler routes into
      // `term.focus()`), so dropping this speculative call loses
      // nothing user-visible.
      // Nudge a render so any code observing termRef.current via state
      // (e.g. theme effect) re-runs with the now-live term.
      forceRender(n => n + 1)
    }

    void boot()

    return cleanup
  }, [rpc, events, terminalId])

  // Pause ghostty's rAF render loop on inactive panes. Without this,
  // every warm-but-hidden TerminalPane ticks at 60fps (cursor blink +
  // dirty-row scan), so CPU scaled with total terminals ever opened.
  // PTY data still flows into wasmTerm while paused; the next resume
  // frame redraws whatever rows changed.
  useEffect(() => {
    if (!readyRef.current) return
    const term = termRef.current
    const fit = fitRef.current
    if (!term) return
    if (!isActive) {
      pauseRenderLoop(term)
      return
    }
    resumeRenderLoop(term)
    // rAF: measure after the parent's display flip has laid out.
    const raf = requestAnimationFrame(() => {
      try { fit?.fit() } catch {}
      try { term.focus() } catch {}
    })
    return () => cancelAnimationFrame(raf)
  }, [isActive])

  // Parent→child focus push (component-view edition).
  //
  // The bottom-panel host focuses our pane wrapper directly
  // (`[data-bottom-panel-focus-target]` + `tabIndex={-1}` below) when
  // the panel opens or the active tab changes. We catch the
  // resulting `focus` event on the wrapper and route it into the
  // xterm, so keystrokes land on the prompt instead of the wrapper
  // div.
  //
  // Previously (iframe mode) this listener was attached to `window`
  // because the parent focused the iframe element and that fired
  // `focus` on the iframe's window. In component mode the term
  // shares the host's window, so a window-level listener would also
  // re-grab focus on every `window.focus()` call elsewhere in the
  // app — including the close path — and effectively make the
  // terminal sticky. Element-level focus on the wrapper sidesteps
  // that entirely.
  useEffect(() => {
    if (!isActive) return
    const pane = paneRef.current
    if (!pane) return
    const onFocus = () => {
      const term = termRef.current
      if (!term) return
      try { term.focus() } catch {}
    }
    pane.addEventListener("focus", onFocus)
    return () => pane.removeEventListener("focus", onFocus)
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
      // Programmatic focus target for the bottom-panel host's
      // open-focus path. `tabIndex={-1}` makes the div focusable
      // via `.focus()` without putting it in the tab-key order.
      // The `data-` attribute is what `BottomPanel` looks for via
      // `querySelector` when it needs to push focus into a
      // component-mode view.
      //
      // Gated on `isActive` so warmed-but-hidden terminal panes
      // (other tabs in the same scope, other scopes' last terminal)
      // don't claim the focus target. `BottomPanel`'s
      // `wrapper.querySelector("[data-bottom-panel-focus-target]")`
      // would otherwise grab whichever pane happens to come first
      // in document order, and route focus into a terminal the user
      // can't see.
      tabIndex={isActive ? -1 : undefined}
      data-bottom-panel-focus-target={isActive ? "" : undefined}
      className={cn(
        // Strip the default focus ring — we forward focus to the
        // term immediately, so a visible outline on the wrapper
        // would just flash for one frame.
        "outline-none",
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

// ghostty-web doesn't expose a pause API; reach into the private rAF
// handle. If these names ever change the loop just doesn't pause
// (regression to original CPU cost), nothing breaks.
// Shape of the *private* xterm.js internals we poke at to pause /
// resume the render loop when the terminal is offscreen. We can't
// intersect with `Terminal` here because xterm declares `isOpen` (and
// other names below) as `private` on the core class; intersecting a
// class type with another object that re-declares a private name
// collapses the whole intersection to `never`. Casting through
// `unknown` instead keeps each access individually typed.
type InternalTerminal = {
  animationFrameId?: number
  isOpen?: boolean
  isDisposed?: boolean
  startRenderLoop?: () => void
}

function pauseRenderLoop(term: Terminal) {
  const t = term as unknown as InternalTerminal
  if (t.animationFrameId != null) {
    cancelAnimationFrame(t.animationFrameId)
    t.animationFrameId = undefined
  }
}

function resumeRenderLoop(term: Terminal) {
  const t = term as unknown as InternalTerminal
  if (t.isDisposed || !t.isOpen) return
  if (t.animationFrameId != null) return
  try { t.startRenderLoop?.() } catch {}
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
