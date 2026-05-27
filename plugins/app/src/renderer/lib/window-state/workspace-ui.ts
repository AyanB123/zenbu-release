import { useCallback } from "react"
import { useDb, useDbClient } from "@zenbujs/core/react"
import type { LeftSidebarTab } from "./types"
import { useWindowId } from "./window-id"
import {
  ensureActiveWorkspaceUiState,
  ensureWindowState,
  readActiveWorkspaceUiState,
} from "./ensure"

export function useLeftSidebarTab(): LeftSidebarTab {
  const windowId = useWindowId()
  return useDb(root => {
    const ws = root.app.windowStates[windowId]
    const raw = readActiveWorkspaceUiState(ws)?.leftSidebarTab
    // The tab id is an open string — every tab (chat list
    // included) is a plugin-contributed view registered with
    // `meta.kind = "left-sidebar"`. We don't enumerate plugin tabs
    // here; the registry-driven `LeftSidebarTabBar` is the source
    // of truth. `"agent"` is the conventional default because the
    // `agent-sidebar` plugin ships with the host.
    return typeof raw === "string" && raw.length > 0 ? raw : "agent"
  })
}

export function useSetLeftSidebarTab() {
  const windowId = useWindowId()
  const client = useDbClient()
  return useCallback(
    (tab: LeftSidebarTab) => {
      void client.update(root => {
        const ws = ensureWindowState(root, windowId)
        const ui = ensureActiveWorkspaceUiState(ws)
        if (!ui) return
        ui.leftSidebarTab = tab
      })
    },
    [client, windowId],
  )
}

export function useLeftSidebarOpen(): boolean {
  const windowId = useWindowId()
  return useDb(root => {
    const ws = root.app.windowStates[windowId]
    return readActiveWorkspaceUiState(ws)?.leftSidebarOpen ?? true
  })
}

export function useSetLeftSidebarOpen() {
  const windowId = useWindowId()
  const client = useDbClient()
  return useCallback(
    (open: boolean | ((prev: boolean) => boolean)) => {
      void client.update(root => {
        const ws = ensureWindowState(root, windowId)
        const ui = ensureActiveWorkspaceUiState(ws)
        if (!ui) return
        const prev = ui.leftSidebarOpen ?? true
        ui.leftSidebarOpen = typeof open === "function" ? open(prev) : open
      })
    },
    [client, windowId],
  )
}
