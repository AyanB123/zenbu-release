import { useCallback } from "react"
import { useDb, useDbClient } from "@zenbujs/core/react"
import type { WorkspaceLayoutView } from "./types"
import { useWindowId } from "./window-id"
import {
  ensureActiveScopeUiState,
  ensureActiveWorkspaceUiState,
  ensureWindowState,
  readActiveScopeUiState,
  readActiveWorkspaceUiState,
} from "./ensure"

const EMPTY_LAYOUT: WorkspaceLayoutView = {
  sidebarWidth: null,
  rightSidebarWidth: null,
  terminalHeight: null,
}

/** Combined sash sizes for the shell. `sidebarWidth` lives on the
 * workspace UI state; the other two on the scope UI state. */
export function useWorkspaceLayout(): WorkspaceLayoutView {
  const windowId = useWindowId()
  return useDb(root => {
    const ws = root.app.windowStates[windowId]
    if (!ws) return EMPTY_LAYOUT
    const wsUi = readActiveWorkspaceUiState(ws)
    const scopeUi = readActiveScopeUiState(ws)
    return {
      sidebarWidth: wsUi?.sidebarWidth ?? null,
      rightSidebarWidth: scopeUi?.rightSidebarWidth ?? null,
      terminalHeight: scopeUi?.terminalHeight ?? null,
    }
  })
}

export function useSetWorkspaceLayout() {
  const windowId = useWindowId()
  const client = useDbClient()
  return useCallback(
    (patch: Partial<WorkspaceLayoutView>) => {
      void client.update(root => {
        const ws = ensureWindowState(root, windowId)
        if (patch.sidebarWidth !== undefined) {
          const wsUi = ensureActiveWorkspaceUiState(ws)
          if (wsUi) wsUi.sidebarWidth = patch.sidebarWidth
        }
        if (
          patch.rightSidebarWidth !== undefined ||
          patch.terminalHeight !== undefined
        ) {
          const scopeUi = ensureActiveScopeUiState(ws)
          if (scopeUi) {
            if (patch.rightSidebarWidth !== undefined) {
              scopeUi.rightSidebarWidth = patch.rightSidebarWidth
            }
            if (patch.terminalHeight !== undefined) {
              scopeUi.terminalHeight = patch.terminalHeight
            }
          }
        }
      })
    },
    [client, windowId],
  )
}
