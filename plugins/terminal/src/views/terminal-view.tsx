import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { Allotment, LayoutPriority } from "allotment"
import "allotment/dist/style.css"
import {
  useDb,
  useDbClient,
  useEvents,
  useRpc,
  type ViewComponentProps,
} from "@zenbujs/core/react"
import { TerminalPane } from "./terminal-pane"
import { TerminalTabs } from "./terminal-tabs"
import { useVisited } from "./lib/use-visited"

const DEFAULT_TABS_WIDTH = 180

export type TerminalViewArgs = {
  /** The window the parent shell is rendering. Routed through args
   * because component views don't read parent window state directly. */
  windowId?: string | null
  /** The scope this terminal panel should be acting on (workspace +
   * cwd). Carried explicitly so the view doesn't need to scan
   * `windowStates` to find it. */
  scopeId?: string | null
  /** The cwd new terminals should spawn in. Falls back to the scope's
   * recorded directory if missing. */
  directory?: string | null
  /** Whether the bottom panel is currently expanded. When false the
   * view stays mounted (so reopening is instant) but every terminal
   * pane is treated as hidden — render loops pause, focus/fit
   * effects no-op. Without this signal the active pane's rAF loop
   * keeps ticking at 60fps behind a 0-height pane. */
  panelOpen?: boolean
}

/**
 * The bottom-panel "Terminal" view, as a `rendering: "component"` view
 * contributed by the `terminal` plugin. Same UX as the legacy
 * iframe-mode entry, but rendered inline in the host shell so it
 * doesn't pay iframe overhead and doesn't need its own provider tree.
 *
 * Switching workspaces changes the `scopeId` arg. We deliberately
 * keep every visited scope's `TerminalsForScope` mounted (and just
 * hide non-active ones via `display:none`) instead of swapping with
 * `key={scopeId}`. A remount disposes every xterm, re-attaches, and
 * triggers a fit pass that ends up resizing the underlying pty —
 * SIGWINCH makes zsh redraw its (multi-line, right-padded) prompt at
 * a slightly-different width, which produced a "prompt staircase" on
 * every workspace switch.
 */
export default function TerminalView({
  args,
}: ViewComponentProps<TerminalViewArgs>) {
  const scopeId = args?.scopeId ?? null
  const directory = args?.directory ?? null
  const effectiveWindowId = args?.windowId ?? "main"
  // Default to `true` so older hosts (and any caller that hasn't
  // wired this arg through yet) keep the previous always-active
  // behaviour rather than silently freezing every terminal.
  const panelOpen = args?.panelOpen ?? true

  const visited = useVisited(scopeId)

  // Look up each visited scope's directory once, in the database,
  // instead of relying on the host's `directory` arg — that arg only
  // ever reflects the *currently-active* scope, but inactive
  // TerminalsForScope panes need their own cwd so newly-created
  // terminals inside them land in the right directory.
  const scopesById = useDb(root => root.app.scopes)
  const visitedEntries = useMemo(() => {
    const out: Array<{ id: string; directory: string }> = []
    for (const id of visited) {
      const scope = scopesById[id]
      if (!scope) continue
      out.push({ id, directory: scope.directory })
    }
    return out
  }, [visited, scopesById])

  if (!scopeId || !directory) {
    return (
      <div className="flex h-full items-center justify-center bg-background p-4 text-center text-[12px] text-muted-foreground">
        No active scope.
      </div>
    )
  }

  return (
    <div className="relative h-full min-h-0 w-full">
      {visitedEntries.map(entry => {
        const isActive = entry.id === scopeId
        return (
          <div
            key={entry.id}
            className="absolute inset-0"
            style={{ display: isActive ? "block" : "none" }}
            aria-hidden={!isActive}
          >
            <TerminalsForScope
              scopeId={entry.id}
              directory={entry.directory}
              windowId={effectiveWindowId}
              isPanelActive={isActive && panelOpen}
            />
          </div>
        )
      })}
    </div>
  )
}

type TerminalsForScopeProps = {
  scopeId: string
  directory: string
  windowId: string
  /** True iff this scope is the one currently displayed in the
   * panel. Hidden scopes still keep their xterms alive (no remount
   * → no SIGWINCH → no prompt staircase), but their TerminalPanes
   * shouldn't grab focus or trigger fit passes. */
  isPanelActive: boolean
}

function TerminalsForScope({
  scopeId,
  directory,
  windowId,
  isPanelActive,
}: TerminalsForScopeProps) {
  const rpc = useRpc()
  const dbClient = useDbClient()
  const events = useEvents()

  // Outer focus-context wrapper (`app.terminal`) lives on the root
  // div below; the right-side tab strip wrapper (`app.terminal.tabs`)
  // is nested inside. The prelude collects every focus context up
  // the DOM chain, so when the tabs strip is focused both contexts
  // are active and the broader `app.terminal` shortcuts (Cmd+Shift+T
  // for new terminal) keep working there too.
  const terminalRootRef = useRef<HTMLDivElement>(null)
  const tabsWrapperRef = useRef<HTMLDivElement>(null)

  // Registry of per-terminal "clear" functions. Each TerminalPane
  // registers itself on mount and unregisters on unmount via
  // `registerClear`. The header's ⋯ menu (and the Cmd+K shortcut)
  // route through the active terminal's entry to wipe its scrollback
  // + nudge the shell to redraw its prompt.
  const clearRegistryRef = useRef(new Map<string, () => void>())
  const registerClear = useCallback(
    (terminalId: string, fn: () => void) => {
      clearRegistryRef.current.set(terminalId, fn)
      return () => {
        if (clearRegistryRef.current.get(terminalId) === fn) {
          clearRegistryRef.current.delete(terminalId)
        }
      }
    },
    [],
  )

  const activeTerminalId = useDb(root => {
    const id = root.app.windowStates[windowId]?.scopeLastTerminal?.[scopeId]
    if (!id) return null
    return root.app.terminals[id] ? id : null
  })

  const terminalsById = useDb(root => root.app.terminals)
  const scopeTerminals = useMemo(
    () =>
      Object.values(terminalsById)
        .filter(t => t.scopeId === scopeId)
        .sort((a, b) => a.createdAt - b.createdAt),
    [terminalsById, scopeId],
  )

  const setActiveTerminal = useCallback(
    (terminalId: string) => {
      void dbClient.update(root => {
        const ws = root.app.windowStates[windowId]
        if (!ws) return
        if (!ws.scopeLastTerminal) ws.scopeLastTerminal = {}
        ws.scopeLastTerminal[scopeId] = terminalId
      })
    },
    [dbClient, scopeId, windowId],
  )

  const handleCreate = useCallback(async () => {
    const { terminalId } = await rpc.app.terminal.create({
      scopeId,
      cwd: directory,
    })
    setActiveTerminal(terminalId)
  }, [rpc, scopeId, directory, setActiveTerminal])

  const handleClose = useCallback(
    async (terminalId: string) => {
      // When the user closes the *active* terminal, pick its
      // neighbour up-front and pin it as the new active so the UI
      // doesn't flash to the auto-fallback before settling.
      if (terminalId === activeTerminalId) {
        const idx = scopeTerminals.findIndex(t => t.id === terminalId)
        const next =
          scopeTerminals[idx + 1] ?? scopeTerminals[idx - 1] ?? null
        if (next) setActiveTerminal(next.id)
      }
      await rpc.app.terminal.dispose({ terminalId })
    },
    [activeTerminalId, scopeTerminals, setActiveTerminal, rpc],
  )

  const handleClearActive = useCallback(() => {
    if (!activeTerminalId) return
    clearRegistryRef.current.get(activeTerminalId)?.()
  }, [activeTerminalId])

  const handleCloseActive = useCallback(() => {
    if (!activeTerminalId) return
    void handleClose(activeTerminalId)
  }, [activeTerminalId, handleClose])

  // Cmd+K / Ctrl+K = "clear screen". Listen at the document level
  // with `useCapture` so we run before ghostty-web's contenteditable
  // input target swallows the keystroke as a literal control char.
  //
  // Only the panel-active scope reacts — hidden TerminalsForScope
  // siblings register the same listener but no-op while their
  // `isPanelActive` is false.
  useEffect(() => {
    if (!isPanelActive) return
    const onKeyDown = (e: KeyboardEvent) => {
      const cmd = e.metaKey || e.ctrlKey
      if (!cmd) return
      if (e.altKey || e.shiftKey) return
      if (e.key !== "k" && e.key !== "K") return
      e.preventDefault()
      e.stopPropagation()
      handleClearActive()
    }
    document.addEventListener("keydown", onKeyDown, true)
    return () => document.removeEventListener("keydown", onKeyDown, true)
  }, [isPanelActive, handleClearActive])

  // Ensure the scope always has at least one terminal as long as
  // the panel is mounted, and that the active selection points at
  // a live terminal.
  const creatingForScope = useRef<string | null>(null)
  useEffect(() => {
    if (scopeTerminals.length === 0) {
      if (creatingForScope.current === scopeId) return
      creatingForScope.current = scopeId
      void handleCreate().finally(() => {
        if (creatingForScope.current === scopeId) {
          creatingForScope.current = null
        }
      })
      return
    }
    if (activeTerminalId && terminalsById[activeTerminalId]) return
    const fallback = scopeTerminals[scopeTerminals.length - 1]
    if (!fallback) return
    setActiveTerminal(fallback.id)
  }, [
    activeTerminalId,
    handleCreate,
    scopeId,
    scopeTerminals,
    setActiveTerminal,
    terminalsById,
  ])

  const visited = useVisited(activeTerminalId)
  const visitedScopedTerminals = useMemo(
    () =>
      Array.from(visited)
        .map(id => terminalsById[id])
        .filter((t): t is NonNullable<typeof t> => t != null)
        .filter(t => t.scopeId === scopeId),
    [visited, terminalsById, scopeId],
  )

  const tabEntries = useMemo(
    () => scopeTerminals.map(t => ({ id: t.id, title: t.title })),
    [scopeTerminals],
  )

  const [tabsWidth, setTabsWidth] = useState(DEFAULT_TABS_WIDTH)

  // Terminal-context shortcuts. Same `isPanelActive` gating as the
  // Cmd+K listener above: only the visible TerminalsForScope reacts
  // even though hidden siblings stay mounted (no SIGWINCH on
  // workspace switch).
  useEffect(() => {
    if (!isPanelActive) return
    const offNew = events.app.terminalNew.subscribe(() => {
      void handleCreate()
    })
    const offFocusTabs = events.app.terminalFocusTabs.subscribe(() => {
      tabsWrapperRef.current?.focus({ preventScroll: true })
    })
    const focusActivePane = () => {
      // `TerminalPane` marks its outer div with
      // `data-bottom-panel-focus-target` when it's the active pane
      // and gives it `tabIndex={-1}` + a `focus` listener that
      // forwards into the xterm. Routing focus through that div
      // means our handler doesn't need to know anything about the
      // ghostty internals.
      const pane = terminalRootRef.current?.querySelector<HTMLElement>(
        "[data-bottom-panel-focus-target]",
      )
      if (pane) {
        pane.focus({ preventScroll: true })
      } else {
        terminalRootRef.current?.focus({ preventScroll: true })
      }
    }
    const offFocusActive = events.app.terminalFocusActive.subscribe(() => {
      focusActivePane()
    })
    const offMove = events.app.terminalTabsMove.subscribe(({ dir }) => {
      if (scopeTerminals.length === 0) return
      const idx = scopeTerminals.findIndex(t => t.id === activeTerminalId)
      const baseIdx = idx < 0 ? 0 : idx
      const delta = dir === "down" ? 1 : -1
      const nextIdx =
        (baseIdx + delta + scopeTerminals.length) % scopeTerminals.length
      const next = scopeTerminals[nextIdx]
      if (next) setActiveTerminal(next.id)
    })
    const offActivate = events.app.terminalTabsActivate.subscribe(() => {
      // Mirror `terminalFocusActive` — same payload, same effect.
      focusActivePane()
    })
    const offClose = events.app.terminalTabsClose.subscribe(() => {
      if (!activeTerminalId) return
      void handleClose(activeTerminalId)
      // Keep the tabs strip focused after a close so the user can
      // keep navigating without re-pressing Ctrl+`.
      requestAnimationFrame(() => {
        tabsWrapperRef.current?.focus({ preventScroll: true })
      })
    })
    return () => {
      offNew()
      offFocusTabs()
      offFocusActive()
      offMove()
      offActivate()
      offClose()
    }
  }, [
    events,
    isPanelActive,
    handleCreate,
    handleClose,
    scopeTerminals,
    activeTerminalId,
    setActiveTerminal,
  ])

  return (
    <div
      ref={terminalRootRef}
      tabIndex={-1}
      data-zenbu-focus-context="app.terminal"
      className="relative h-full min-h-0 w-full outline-none"
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
    >
      <Allotment
        proportionalLayout={false}
        onChange={sizes => {
          const right = sizes[1]
          if (right != null && right > 0) setTabsWidth(right)
        }}
      >
        <Allotment.Pane priority={LayoutPriority.High}>
          <div className="relative h-full min-h-0 min-w-0">
            {visitedScopedTerminals.map(terminal => {
              const isActive =
                isPanelActive && terminal.id === activeTerminalId
              return (
                <div
                  key={terminal.id}
                  className="absolute inset-0"
                  style={{ display: isActive ? "block" : "none" }}
                  aria-hidden={!isActive}
                >
                  <TerminalPane
                    terminalId={terminal.id}
                    isActive={isActive}
                    rightAdjacent
                    registerClear={registerClear}
                  />
                </div>
              )
            })}
          </div>
        </Allotment.Pane>
        <Allotment.Pane
          minSize={0}
          preferredSize={tabsWidth}
          priority={LayoutPriority.Low}
        >
          <div
            ref={tabsWrapperRef}
            tabIndex={-1}
            data-zenbu-focus-context="app.terminal.tabs"
            className="h-full outline-none"
          >
          <TerminalTabs
            entries={tabEntries}
            activeId={activeTerminalId}
            onSelect={setActiveTerminal}
            onClose={id => {
              void handleClose(id)
            }}
            onCreate={() => {
              void handleCreate()
            }}
            onClearActive={handleClearActive}
            onCloseActive={handleCloseActive}
          />
          </div>
        </Allotment.Pane>
      </Allotment>
    </div>
  )
}
