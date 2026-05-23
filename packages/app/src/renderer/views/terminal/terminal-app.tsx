import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { Allotment, LayoutPriority } from "allotment"
import { useDb, useDbClient, useRpc, useViewArgs } from "@zenbujs/core/react"
import { useThemeSync } from "@/lib/theme"
import { TerminalPane } from "@/components/terminal-pane"
import { TerminalTabs } from "@/components/layout/terminal-tabs"
import { useVisited } from "@/lib/hooks/use-visited"

const DEFAULT_TABS_WIDTH = 180

export type TerminalViewArgs = {
  /** The window the parent shell is rendering. Routed through args
   * because iframes don't inherit `?windowId=` from the parent. */
  windowId?: string
  /** The scope this terminal panel should be acting on (workspace +
   * cwd). Carried explicitly so the view doesn't need to scan
   * `windowStates` to find it. */
  scopeId?: string
  /** The cwd new terminals should spawn in. Falls back to the scope's
   * recorded directory if missing. */
  directory?: string
}

/**
 * The bottom-panel "Terminal" view. Same UX as the inline
 * `TerminalsHost` it replaces, but driven by `args` (scope + cwd)
 * instead of reading the active scope out of windowState directly.
 * Multiple bottom-panel views can now coexist (terminal, run output,
 * debug console, …) and a plugin can register a new one without
 * touching the host shell.
 *
 * Switching workspaces changes the `scopeId` arg. We deliberately
 * keep every visited scope's `TerminalsForScope` mounted (and just
 * hide non-active ones via `display:none`) instead of swapping with
 * `key={scopeId}`. A remount disposes every xterm, re-attaches, and
 * triggers a fit pass that ends up resizing the underlying pty —
 * SIGWINCH makes zsh redraw its (multi-line, right-padded) prompt at
 * a slightly-different width, which is what was producing the
 * "prompt staircase" on every workspace switch.
 */
export function TerminalApp() {
  useThemeSync()
  const args = useViewArgs<TerminalViewArgs>()
  const { scopeId, directory, windowId } = args
  const effectiveWindowId = windowId ?? "main"

  const visited = useVisited(scopeId ?? null)

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
              isPanelActive={isActive}
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

  // Registry of per-terminal "clear" functions. Each TerminalPane
  // registers itself on mount and unregisters on unmount via
  // `registerClear`. The header's ⋯ menu (and the Cmd+K shortcut)
  // route through the active terminal's entry to wipe its scrollback
  // + nudge the shell to redraw its prompt. We keep the registry in
  // a ref so re-registering doesn't churn React state and rerender
  // every tab.
  const clearRegistryRef = useRef(new Map<string, () => void>())
  const registerClear = useCallback(
    (terminalId: string, fn: () => void) => {
      clearRegistryRef.current.set(terminalId, fn)
      return () => {
        // Only forget the entry if it still points at the fn we
        // registered. Avoids races where a remount registers a new
        // fn before the previous unmount's cleanup runs.
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
      // doesn't first flash to the auto-fallback (which lands on
      // whichever tab happens to be last in the scope) before
      // settling. Selection rule, mirroring VS Code / iTerm:
      //
      //   1. If there's a row below the closed one, go down.
      //   2. Otherwise, if there's a row above, go up.
      //   3. If neither exists (this was the only terminal),
      //      leave selection alone — the empty-scope auto-create
      //      effect below will spawn a fresh terminal and pin it
      //      active on the next render.
      //
      // We set the active *before* the dispose RPC so the
      // server-side cleanup of `scopeLastTerminal[scopeId]` (which
      // only fires when the pointer still references the deleted
      // id) becomes a no-op — the selection has already moved.
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

  // Cmd+K (mac) / Ctrl+K (everywhere else) is the canonical "clear
  // screen" shortcut in iTerm / Terminal.app / VS Code. We listen
  // here at the document level instead of inside `TerminalPane`:
  // ghostty-web puts its keystroke target on a `contenteditable`
  // descendant of the pane, which absorbs keydowns before any
  // listener attached to the pane's host div ever sees them.
  // Listening on the document with `useCapture` runs before the
  // contenteditable's own handler, so we can `preventDefault` and
  // route the keystroke into the clear path instead of letting it
  // be inserted as a literal control character.
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

  // Make sure the scope always has at least one terminal as long as
  // the panel is mounted, and that the active selection points at a
  // live terminal. Mirrors the old TerminalsHost behaviour.
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

  return (
    <div
      className="relative h-full min-h-0 w-full"
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
              // "Active" requires both: this is the selected tab
              // *and* this scope is the one being shown in the
              // panel. A backgrounded workspace's selected tab is
              // not really active.
              const isActive =
                isPanelActive && terminal.id === activeTerminalId
              // We deliberately don't use React 19's <Activity> here.
              // Activity unmounts effects when mode="hidden", which
              // would dispose the xterm + tear down our RPC
              // subscriptions on every tab switch. On switching back
              // we'd re-attach and dump a replay buffer in, which
              // races with live pty output and made it feel like
              // sessions were bleeding into each other. A plain
              // display:none keeps every visited TerminalPane warm:
              // its term stays alive, subscriptions stay live, and
              // switching tabs is just a CSS flip.
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
        </Allotment.Pane>
      </Allotment>
    </div>
  )
}
