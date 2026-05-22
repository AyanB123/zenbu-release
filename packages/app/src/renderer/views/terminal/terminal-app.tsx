import {
  Activity,
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
 */
export function TerminalApp() {
  useThemeSync()
  const args = useViewArgs<TerminalViewArgs>()
  const { scopeId, directory, windowId } = args
  const effectiveWindowId = windowId ?? "main"

  if (!scopeId || !directory) {
    return (
      <div className="flex h-full items-center justify-center bg-background p-4 text-center text-[12px] text-muted-foreground">
        No active scope.
      </div>
    )
  }

  return (
    <TerminalsForScope
      key={scopeId}
      scopeId={scopeId}
      directory={directory}
      windowId={effectiveWindowId}
    />
  )
}

type TerminalsForScopeProps = {
  scopeId: string
  directory: string
  windowId: string
}

function TerminalsForScope({
  scopeId,
  directory,
  windowId,
}: TerminalsForScopeProps) {
  const rpc = useRpc()
  const dbClient = useDbClient()

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
      await rpc.app.terminal.dispose({ terminalId })
    },
    [rpc],
  )

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
            {visitedScopedTerminals.map(terminal => (
              <Activity
                key={terminal.id}
                mode={terminal.id === activeTerminalId ? "visible" : "hidden"}
              >
                <div className="absolute inset-0">
                  <TerminalPane terminalId={terminal.id} rightAdjacent />
                </div>
              </Activity>
            ))}
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
          />
        </Allotment.Pane>
      </Allotment>
    </div>
  )
}
