import { Activity, useCallback, useEffect, useMemo, useRef } from "react"
import { nanoid } from "nanoid"
import { View, useDb, useDbClient, useRpc } from "@zenbujs/core/react"
import type { Schema } from "../../../main/schema"
import { ChatPane } from "../chat/chat-pane"
import { ChatTabs, type ChatTabEntry } from "./chat-tabs"
import { chatLabel } from "@/lib/chat-label"
import { useVisited } from "@/lib/hooks/use-visited"
import {
  assignChatToTabInRoot,
  openChatInNewTabInRoot,
  paneTabChatId,
  useAddPane,
  useAddTab,
  useClosePane,
  useCloseTab,
  useGoBackInTab,
  useGoForwardInTab,
  useSelectPane,
  useSelectTab,
  useWindowId,
  type PaneTabView,
  type PaneView,
} from "@/lib/window-state"

export type ChatPaneContainerProps = {
  workspaceId: string
  pane: PaneView
  isActivePane: boolean
  /** Whether another pane sits to our left in the host layout. Forwarded
   * to ChatPane so it knows whether to round its top-left corner. */
  leftAdjacent: boolean
  rightAdjacent: boolean
  bottomAdjacent: boolean
  /** Used to suppress tab chrome when the whole host has exactly one
   * pane and that pane has exactly one tab. Both conditions need to
   * hold — a second pane with a single tab still needs its tab bar
   * so the split is legible and the close affordance is reachable. */
  hideStripWhenSingleTab: boolean
  paneCount: number
}

/** One pane in the chats host. Owns its own tab strip and renders every
 * visited tab (chat or view) under an `<Activity>` so state stays warm
 * when the user flips between tabs. Tabs whose content is a registered
 * view are mounted via `<View />`; tabs whose content is a chat are
 * mounted via `<ChatPane />`. */
export function ChatPaneContainer({
  workspaceId,
  pane,
  isActivePane,
  leftAdjacent,
  rightAdjacent,
  bottomAdjacent,
  hideStripWhenSingleTab,
  paneCount,
}: ChatPaneContainerProps) {
  const chatsById = useDb(root => root.app.chats)
  const sessionsById = useDb(root => root.app.sessions)
  const viewRegistry = useDb(root => root.core.lastKnownViewRegistry ?? [])

  const activeTab = useMemo<PaneTabView | null>(
    () =>
      pane.tabs.find(t => t.id === pane.activeTabId) ?? pane.tabs[0] ?? null,
    [pane.tabs, pane.activeTabId],
  )

  // Track ids we've ever shown so React keeps DOM mounted. We key by
  // tab id (not chatId) so view tabs participate too — multiple view
  // tabs of the same type stay isolated, and switching back to a tab
  // doesn't pay the iframe boot cost again.
  const visited = useVisited(activeTab?.id ?? null)
  const visitedTabs = useMemo(
    () => pane.tabs.filter(t => visited.has(t.id)),
    [pane.tabs, visited],
  )

  const viewLabelFor = useCallback(
    (viewType: string): string => {
      const entry = viewRegistry.find(v => v.type === viewType)
      return entry?.meta?.label ?? formatLabel(viewType)
    },
    [viewRegistry],
  )

  const tabEntries = useMemo<ChatTabEntry[]>(
    () =>
      pane.tabs.map(t => {
        if (t.content.kind === "view") {
          // Special-case the `file` view: each instance shows a
          // different file, so the tab title should be the file's
          // basename rather than the generic registry label.
          let title = viewLabelFor(t.content.viewType)
          if (t.content.viewType === "file") {
            const p = t.content.args.path
            if (typeof p === "string" && p.length > 0) {
              title = basenameOf(p)
            }
          }
          return {
            id: t.id,
            title,
            hasChat: false,
            sessionId: null,
            isStreaming: false,
            isView: true,
          }
        }
        const chat = t.content.chatId ? chatsById[t.content.chatId] : null
        const title = chat ? chatLabel(chat, sessionsById) : "New tab"
        const sessionId =
          chat && chat.session.kind === "ready"
            ? chat.session.sessionId
            : null
        const sessionRecord = sessionId ? sessionsById[sessionId] : null
        const isStreaming = sessionRecord?.isStreaming ?? false
        // Only show unread on tabs that aren't the active tab of
        // a focused pane. `SessionActivityService` stamps
        // `lastOpenedAt` for active tabs, but it only fires AFTER
        // a db update lands — the local `t.id !== pane.activeTabId
        // || !isActivePane` guard avoids a 1-frame flash where the
        // dot would otherwise be visible on the tab the user just
        // clicked into.
        const isFocusedHere = isActivePane && t.id === pane.activeTabId
        const hasUnread =
          !isFocusedHere &&
          sessionRecord != null &&
          sessionRecord.lastCompletedAt != null &&
          sessionRecord.lastCompletedAt >
            (sessionRecord.lastOpenedAt ?? 0)
        return {
          id: t.id,
          title,
          hasChat: !!chat,
          sessionId,
          isStreaming,
          hasUnread,
          isView: false,
        }
      }),
    [pane.tabs, pane.activeTabId, isActivePane, chatsById, sessionsById, viewLabelFor],
  )

  const selectPane = useSelectPane()
  const selectTab = useSelectTab()
  const addTab = useAddTab()
  const closeTab = useCloseTab()
  const addPane = useAddPane()
  const closePane = useClosePane()
  const goBack = useGoBackInTab()
  const goForward = useGoForwardInTab()
  const dbClient = useDbClient()
  const windowId = useWindowId()

  // Per-tab back/forward derive entirely from the active tab's
  // history cursor — we treat each tab as its own browser-style
  // navigation stack, persisted in the DB so the arrows stay
  // meaningful across reloads.
  const activeHistory = activeTab?.history
  const canGoBack =
    !!activeHistory && activeHistory.index > 0
  const canGoForward =
    !!activeHistory &&
    activeHistory.index < activeHistory.entries.length - 1

  const handleBack = useCallback(() => {
    if (!activeTab) return
    goBack(workspaceId, pane.id, activeTab.id)
  }, [goBack, workspaceId, pane.id, activeTab])

  const handleForward = useCallback(() => {
    if (!activeTab) return
    goForward(workspaceId, pane.id, activeTab.id)
  }, [goForward, workspaceId, pane.id, activeTab])

  const handleSelectTab = useCallback(
    (tabId: string) => {
      selectTab(workspaceId, pane.id, tabId)
    },
    [selectTab, workspaceId, pane.id],
  )

  const handleCloseTab = useCallback(
    (tabId: string) => {
      closeTab(workspaceId, pane.id, tabId)
    },
    [closeTab, workspaceId, pane.id],
  )

  const handleNewTab = useCallback(() => {
    addTab(workspaceId, pane.id)
  }, [addTab, workspaceId, pane.id])

  const handleSplit = useCallback(() => {
    addPane(workspaceId, pane.id)
  }, [addPane, workspaceId, pane.id])

  const handleClosePane = useCallback(() => {
    closePane(workspaceId, pane.id)
  }, [closePane, workspaceId, pane.id])

  const handleOpenInNewTab = useCallback(
    (tabId: string) => {
      const tab = pane.tabs.find(t => t.id === tabId)
      const chatId = paneTabChatId(tab)
      if (!chatId) return
      void dbClient.update(root => {
        openChatInNewTabInRoot(root, windowId, chatId)
      })
    },
    [pane.tabs, dbClient, windowId],
  )

  const handlePaneMouseDown = useCallback(() => {
    if (!isActivePane) selectPane(workspaceId, pane.id)
  }, [isActivePane, selectPane, workspaceId, pane.id])

  // When the host has exactly one pane AND that pane has exactly one
  // tab, suppress the tab strip entirely (per request: don't expose
  // tab UI until the user opts in).
  const hideTabBar = hideStripWhenSingleTab && pane.tabs.length === 1
  const activeChatId = paneTabChatId(activeTab)
  const activeChat = activeChatId ? chatsById[activeChatId] : null
  const activeIsView = activeTab?.content.kind === "view"

  // Safety net for two adjacent failure modes that both manifest as
  // "the chat surface looks alive but Enter does nothing":
  //
  //   1. Legacy / edge-case data: a chat tab points at `chatId=null`
  //      (or a chatId that no longer resolves). We fabricate a fresh
  //      chat in the workspace's primary scope and assign it to the
  //      tab, then materialize its session.
  //   2. Pending session: the chat exists but its `session` is still
  //      `{ kind: "pending" }` because whoever created it didn't (or
  //      couldn't) follow up with `createChatSession`. The most
  //      visible offender historically was `SentinelWorkspaceService`
  //      — fixed at the source now — but anything that creates a
  //      pending chat and forgets the RPC ends up here too. We just
  //      fire `createChatSession`; it's idempotent (returns the
  //      existing sessionId if the chat is already ready), so a
  //      duplicate against a race winner is harmless.
  //
  // We key the re-entrancy guard by `tab.id + chatId` so flipping
  // chats in the same tab doesn't lock the second one out, and
  // re-opening the workspace re-arms it.
  const rpc = useRpc()
  const filledTabRef = useRef<string | null>(null)
  const primaryScopeId = useDb(root => {
    let earliest: { id: string; createdAt: number } | null = null
    for (const scope of Object.values(root.app.scopes)) {
      if (scope.workspaceId !== workspaceId) continue
      if (!earliest || scope.createdAt < earliest.createdAt) {
        earliest = { id: scope.id, createdAt: scope.createdAt }
      }
    }
    return earliest?.id ?? null
  })
  useEffect(() => {
    if (activeIsView) return
    if (!activeTab) return
    if (activeTab.content.kind !== "chat") return

    // Case 2: the chat exists but its session is still pending.
    // Fire-and-forget the materialize RPC; the chat record flips to
    // `ready` on the next replica tick and the surface comes alive
    // without remounting.
    if (activeChat && activeChat.session.kind === "pending") {
      const guardKey = `${activeTab.id}:${activeChat.id}`
      if (filledTabRef.current === guardKey) return
      filledTabRef.current = guardKey
      void rpc.app.sessions
        .createChatSession({
          scopeId: activeChat.scopeId,
          chatId: activeChat.id,
        })
        .catch(err =>
          console.error(
            "[chat-pane] auto materialize pending chat failed:",
            err,
          ),
        )
      return
    }

    // Case 1: no chat record under this tab — fabricate one.
    if (activeChat) return
    if (filledTabRef.current === activeTab.id) return
    if (!primaryScopeId) return
    filledTabRef.current = activeTab.id
    const targetScopeId = primaryScopeId
    const chatId = nanoid()
    const now = Date.now()
    void dbClient
      .update(root => {
        root.app.chats[chatId] = {
          id: chatId,
          scopeId: targetScopeId,
          session: { kind: "pending" },
          createdAt: now,
        }
        assignChatToTabInRoot(
          root,
          windowId,
          workspaceId,
          pane.id,
          activeTab.id,
          chatId,
        )
      })
      .then(() => {
        void rpc.app.sessions
          .createChatSession({ scopeId: targetScopeId, chatId })
          .catch(err =>
            console.error("[chat-pane] auto createChatSession failed:", err),
          )
      })
  }, [
    activeIsView,
    activeChat,
    activeTab,
    dbClient,
    rpc,
    workspaceId,
    primaryScopeId,
    pane.id,
    windowId,
  ])

  const childTopAdjacent = !hideTabBar

  return (
    <div
      onMouseDownCapture={handlePaneMouseDown}
      className="relative flex h-full min-h-0 w-full flex-col"
    >
      {!hideTabBar && (
        <ChatTabs
          entries={tabEntries}
          activeId={pane.activeTabId}
          mode="full"
          paneFocused={isActivePane}
          leftAdjacent={leftAdjacent}
          rightAdjacent={rightAdjacent}
          onSelect={handleSelectTab}
          onClose={handleCloseTab}
          onNewTab={handleNewTab}
          onSplitRight={handleSplit}
          onOpenInNewTab={handleOpenInNewTab}
          onClosePane={handleClosePane}
          canClosePane={paneCount > 1}
          onBack={handleBack}
          onForward={handleForward}
          canGoBack={canGoBack}
          canGoForward={canGoForward}
        />
      )}
      <div className="relative min-h-0 flex-1">
        {visitedTabs.map(tab => (
          <TabPanel
            key={tab.id}
            tab={tab}
            visible={tab.id === activeTab?.id}
            chat={
              tab.content.kind === "chat" && tab.content.chatId
                ? chatsById[tab.content.chatId] ?? null
                : null
            }
            leftAdjacent={leftAdjacent}
            rightAdjacent={rightAdjacent}
            bottomAdjacent={bottomAdjacent}
            topAdjacent={childTopAdjacent}
          />
        ))}
      </div>
    </div>
  )
}

type Chat = Schema["chats"][string]

type TabPanelProps = {
  tab: PaneTabView
  visible: boolean
  chat: Chat | null
  leftAdjacent: boolean
  rightAdjacent: boolean
  bottomAdjacent: boolean
  topAdjacent: boolean
}

function TabPanel({
  tab,
  visible,
  chat,
  leftAdjacent,
  rightAdjacent,
  bottomAdjacent,
  topAdjacent,
}: TabPanelProps) {
  return (
    <Activity mode={visible ? "visible" : "hidden"}>
      <div className="absolute inset-0">
        {tab.content.kind === "view" ? (
          <View
            type={tab.content.viewType}
            args={tab.content.args}
            className="size-full"
            fallback={
              <div className="flex h-full items-center justify-center text-[11px] text-muted-foreground">
                Loading view…
              </div>
            }
          />
        ) : (
          <ChatPane
            chat={chat}
            leftAdjacent={leftAdjacent}
            bottomAdjacent={bottomAdjacent}
            rightAdjacent={rightAdjacent}
            topAdjacent={topAdjacent}
          />
        )}
      </div>
    </Activity>
  )
}

function formatLabel(type: string): string {
  const tail = type.includes("/") ? type.split("/").pop()! : type
  return tail.replace(/[-_]/g, " ")
}

function basenameOf(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? p
}
