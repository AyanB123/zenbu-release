import { useCallback } from "react"
import { useDb, useDbClient } from "@zenbujs/core/react"
import type { Root } from "./types"
import { useWindowId } from "./window-id"
import { ensureWindowState } from "./ensure"

export function useActiveTerminalId(): string | null {
  const windowId = useWindowId()
  return useDb(root => {
    const ws = root.app.windowStates[windowId]
    if (!ws) return null
    const scopeId = ws.selectedScopeId
    if (!scopeId) return null
    const id = ws.scopeLastTerminal?.[scopeId]
    if (!id) return null
    return root.app.terminals[id] ? id : null
  })
}

export function selectTerminalInRoot(
  root: Root,
  windowId: string,
  terminalId: string,
): void {
  const terminal = root.app.terminals[terminalId]
  if (!terminal) return
  const ws = ensureWindowState(root, windowId)
  ws.scopeLastTerminal[terminal.scopeId] = terminalId
}

export function useSelectTerminal() {
  const windowId = useWindowId()
  const client = useDbClient()
  return useCallback(
    (terminalId: string) => {
      void client.update(root => {
        selectTerminalInRoot(root, windowId, terminalId)
      })
    },
    [client, windowId],
  )
}
