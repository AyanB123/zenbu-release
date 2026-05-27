import { useCallback } from "react"
import { useDb, useDbClient } from "@zenbujs/core/react"
import { useWindowId } from "./window-id"

/**
 * Worktree-group collapse helpers.
 *
 * The underlying state lives in the `agentSidebar` plugin's
 * schema (`root.agentSidebar.worktreeGroupCollapsed[windowId][scopeId]`)
 * because every consumer is sidebar-specific. The helpers stay in
 * the host's `lib/window-state/` directory because the host shell
 * (``<ListNav>``) also needs to read the state to
 * decide which rows to skip over with the arrow keys, and pulling
 * a runtime import out of the plugin into the host would
 * over-couple the two packages \u2014 we use the host's
 * `dependsOn agentSidebar` type link instead.
 */
export function useWorktreeGroupCollapsed(): Record<string, boolean> {
  const windowId = useWindowId()
  return useDb(
    root => root.agentSidebar.worktreeGroupCollapsed[windowId] ?? {},
  )
}

export function useToggleWorktreeGroupCollapsed() {
  const windowId = useWindowId()
  const client = useDbClient()
  return useCallback(
    (scopeId: string, collapsed?: boolean) => {
      void client.update(root => {
        const byWindow = root.agentSidebar.worktreeGroupCollapsed
        const forWindow = byWindow[windowId] ?? (byWindow[windowId] = {})
        const current = forWindow[scopeId] ?? false
        forWindow[scopeId] = collapsed != null ? collapsed : !current
      })
    },
    [client, windowId],
  )
}
