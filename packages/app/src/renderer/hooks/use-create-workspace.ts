import { useCallback } from "react"
import { useRpc } from "@zenbujs/core/react"
import { useWindowId } from "@/lib/window-state"

/**
 * Creates a workspace + initial scope + initial chat for the given
 * local directory, selects it in the current window, and returns
 * the new ids. Shared between the sidebar's "+" button and the
 * empty-workspace onboarding screen.
 *
 * The whole transaction lives in `WorkspacesService.createFromDirectory`
 * on the main side. We could in principle do all the DB writes
 * directly from the renderer, but the immediately-following
 * `createChatSession` reads the scope/chat we just wrote — and
 * `client.update`'s ack semantics are "central cache consistent",
 * not "every replica consistent", so a renderer-side write followed
 * by a main-side read is a real race (see
 * `WorkspacesService.createFromDirectory` for the full rationale).
 * Doing everything on main keeps the read-after-write within one
 * replica and makes the flow deterministic.
 *
 * The hook is the public contract; callers don't care that it's an
 * RPC under the hood. They `await` it inside a `try/catch` and
 * surface errors as `setError(...)`, same as before.
 */
export function useCreateWorkspaceFromDirectory() {
  const rpc = useRpc()
  const windowId = useWindowId()

  return useCallback(
    async (directory: string) => {
      return await rpc.app.workspaces.createFromDirectory({
        directory,
        windowId,
      })
    },
    [rpc, windowId],
  )
}
