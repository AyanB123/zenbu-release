import { useMemo } from "react"
import { Allotment } from "allotment"
import { ChatPaneContainer } from "./chat-pane-container"
import { ChatPane } from "../chat/chat-pane"
import {
  useActiveWorkspaceId,
  useWorkspacePanes,
  type PaneView,
  type WorkspacePaneStateView,
} from "@/lib/window-state"
import { useDb } from "@zenbujs/core/react"

export type ChatsHostProps = {
  leftAdjacent?: boolean
  bottomAdjacent?: boolean
  rightAdjacent?: boolean
}

/** Renders the chat working area as a horizontal Allotment of panes,
 * one per `windowState.workspacePanes[workspace].panes` entry. Each
 * pane owns its own tab strip and visited-chat-cache.
 *
 * When no workspace is selected, or no pane state has been seeded
 * yet, we render a single chat pane against the resolved "latest
 * chat in the workspace" so the host always shows something. Helpers
 * in `window-state.ts` materialize the real pane state on the first
 * user interaction. */
export function ChatsHost({
  leftAdjacent,
  bottomAdjacent,
  rightAdjacent,
}: ChatsHostProps) {
  const workspaceId = useActiveWorkspaceId()
  const realPaneState = useWorkspacePanes()

  // Fallback synthetic state for "workspace selected but no pane
  // state yet". Not persisted; the first user interaction commits
  // one through the regular helpers.
  const fallbackChatId = useDb(root => {
    if (!workspaceId) return null
    if (realPaneState) return null
    const wsScopes = new Set<string>()
    for (const scope of Object.values(root.app.scopes)) {
      if (scope.workspaceId === workspaceId) wsScopes.add(scope.id)
    }
    let latestId: string | null = null
    let latestAt = -Infinity
    for (const chat of Object.values(root.app.chats)) {
      if (!wsScopes.has(chat.scopeId)) continue
      if (chat.createdAt > latestAt) {
        latestAt = chat.createdAt
        latestId = chat.id
      }
    }
    return latestId
  })

  const paneState = useMemo<WorkspacePaneStateView | null>(() => {
    if (realPaneState) return realPaneState
    if (!workspaceId) return null
    const tabContent = { kind: "chat" as const, chatId: fallbackChatId }
    const tab = {
      id: "__synthetic_tab__",
      content: tabContent,
      history: { entries: [tabContent], index: 0 },
    }
    const pane: PaneView = {
      id: "__synthetic_pane__",
      tabs: [tab],
      activeTabId: tab.id,
    }
    return { panes: [pane], activePaneId: pane.id }
  }, [realPaneState, workspaceId, fallbackChatId])

  if (!workspaceId || !paneState) {
    return (
      <ChatPane
        chat={null}
        leftAdjacent={leftAdjacent}
        bottomAdjacent={bottomAdjacent}
        rightAdjacent={rightAdjacent}
      />
    )
  }

  const paneCount = paneState.panes.length
  const single = paneCount === 1

  return (
    <Allotment proportionalLayout>
      {paneState.panes.map((pane, idx) => {
        const isLeftmost = idx === 0
        const isRightmost = idx === paneCount - 1
        return (
          <Allotment.Pane key={pane.id} minSize={240}>
            <ChatPaneContainer
              workspaceId={workspaceId}
              pane={pane}
              isActivePane={single || pane.id === paneState.activePaneId}
              leftAdjacent={isLeftmost ? !!leftAdjacent : true}
              rightAdjacent={isRightmost ? !!rightAdjacent : true}
              bottomAdjacent={!!bottomAdjacent}
              hideStripWhenSingleTab={single}
              paneCount={paneCount}
            />
          </Allotment.Pane>
        )
      })}
    </Allotment>
  )
}
