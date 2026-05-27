import { useCallback } from "react"
import { useDb, useDbClient } from "@zenbujs/core/react"
import { useWindowId } from "./window-id"
import {
  ensureActiveScopeUiState,
  ensureWindowState,
  readActiveScopeUiState,
} from "./ensure"

export function useRightSidebarOpenType(): string | null {
  const windowId = useWindowId()
  return useDb(root => {
    const ws = root.app.windowStates[windowId]
    return readActiveScopeUiState(ws)?.rightSidebarOpenType ?? null
  })
}

export function useRightSidebarLastType(): string | null {
  const windowId = useWindowId()
  return useDb(root => {
    const ws = root.app.windowStates[windowId]
    return readActiveScopeUiState(ws)?.rightSidebarLastType ?? null
  })
}

export function useSetRightSidebarOpenType() {
  const windowId = useWindowId()
  const client = useDbClient()
  return useCallback(
    (type: string | null) => {
      void client.update(root => {
        const ws = ensureWindowState(root, windowId)
        const ui = ensureActiveScopeUiState(ws)
        if (!ui) return
        ui.rightSidebarOpenType = type
        if (type != null) ui.rightSidebarLastType = type
      })
    },
    [client, windowId],
  )
}

export function useBottomPanelView(): string | null {
  const windowId = useWindowId()
  return useDb(root => {
    const ws = root.app.windowStates[windowId]
    return readActiveScopeUiState(ws)?.bottomPanelView ?? null
  })
}

export function useSetBottomPanelView() {
  const windowId = useWindowId()
  const client = useDbClient()
  return useCallback(
    (viewType: string | null) => {
      void client.update(root => {
        const ws = ensureWindowState(root, windowId)
        const ui = ensureActiveScopeUiState(ws)
        if (!ui) return
        ui.bottomPanelView = viewType
      })
    },
    [client, windowId],
  )
}

export function useBottomPanelOpen(): boolean {
  const windowId = useWindowId()
  return useDb(root => {
    const ws = root.app.windowStates[windowId]
    return readActiveScopeUiState(ws)?.bottomPanelOpen ?? false
  })
}

export function useSetBottomPanelOpen() {
  const windowId = useWindowId()
  const client = useDbClient()
  return useCallback(
    (open: boolean | ((prev: boolean) => boolean)) => {
      void client.update(root => {
        const ws = ensureWindowState(root, windowId)
        const ui = ensureActiveScopeUiState(ws)
        if (!ui) return
        const prev = ui.bottomPanelOpen ?? false
        ui.bottomPanelOpen = typeof open === "function" ? open(prev) : open
      })
    },
    [client, windowId],
  )
}
