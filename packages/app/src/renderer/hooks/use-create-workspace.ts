import { useCallback } from "react"
import { nanoid } from "nanoid"
import { useDbClient, useRpc } from "@zenbujs/core/react"
import { selectChatInRoot, useWindowId } from "@/lib/window-state"

/**
 * Creates a workspace + initial scope + initial chat for the given local
 * directory, then selects it in the current window. Shared between the
 * sidebar's "+" button and the empty-workspace onboarding screen.
 */
export function useCreateWorkspaceFromDirectory() {
  const rpc = useRpc()
  const dbClient = useDbClient()
  const windowId = useWindowId()

  return useCallback(
    async (directory: string) => {
      const { repoId } = await rpc.app.repos.detectAndSync({ directory })

      const workspaceId = nanoid()
      const scopeId = nanoid()
      const chatId = nanoid()
      const now = Date.now()
      const name = directory.split("/").filter(Boolean).pop() ?? "Workspace"

      await dbClient.update(root => {
        root.app.workspaces[workspaceId] = {
          id: workspaceId,
          name,
          createdAt: now,
          icon: null,
          archived: false,
          sentinel: false,
        }
        root.app.scopes[scopeId] = {
          id: scopeId,
          workspaceId,
          directory,
          repoId,
          extraDirectories: [],
          createdAt: now,
          archived: false,
        }
        root.app.chats[chatId] = {
          id: chatId,
          scopeId,
          session: { kind: "pending" },
          createdAt: now,
        }
        selectChatInRoot(root, windowId, chatId)
      })

      void rpc.app.sessions
        .createChatSession({ scopeId, chatId })
        .catch(err =>
          console.error("[create-workspace] createChatSession failed:", err),
        )

      return { workspaceId, scopeId, chatId }
    },
    [rpc, dbClient, windowId],
  )
}
