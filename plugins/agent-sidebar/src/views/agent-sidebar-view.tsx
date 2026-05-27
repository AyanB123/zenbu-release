import { useEffect } from "react"
import type { ViewComponentProps } from "@zenbujs/core/react"
import { ListNav, useListNav } from "@zenbu/ui/list-nav"
import { useEvents } from "@zenbujs/core/react"
import { useSetLeftSidebarOpen } from "@/lib/window-state/workspace-ui"
import { NewChatSplitButton } from "./components/new-chat-split-button"
import { AgentSidebarFooter } from "./components/agent-sidebar-footer"
import { ChatSidebarItem } from "./components/chat-sidebar-item"
import { WorktreeGroupRow } from "./components/worktree-group-row"
import { WorktreeGroupPinButton } from "./components/worktree-group-pin-button"
import { ChatRowActionButton } from "./components/chat-row-action-button"
import {
  ComposeIcon,
  MoreIcon,
  WorktreeGroupPluginIcon,
} from "./components/icons"
import { openCreateWorktreeDialog } from "@/lib/create-worktree-dialog-store"
import { openArchiveWorktreeDialog } from "@/lib/archive-worktree-dialog-store"
import {
  useActiveRepo,
  useSidebarGroups,
  useScopeRows,
} from "@/hooks/use-sidebar-selectors"
import { useSidebarActions } from "@/hooks/use-sidebar-actions"
import {
  useActiveChatId,
  useActiveScopeId,
} from "@/lib/window-state/active-view"
import {
  useToggleWorktreeGroupCollapsed,
  useWorktreeGroupCollapsed,
} from "@/lib/window-state/worktree-groups"
import { useDb, useDbClient, useRpc } from "@zenbujs/core/react"
import { useWindowId } from "@/lib/window-state/window-id"
import {
  focusPaneShowingChatInRoot,
  selectChatInRoot,
} from "@/lib/window-state/selection"
import { requestFocusComposer } from "@/lib/focus-composer"
import { useWorkspaceContextMenu } from "@/hooks/use-workspace-context-menu"
import { worktreeGroupLabel } from "@/lib/sidebar-helpers"
import {
  SIDEBAR_FOOTER_FADE,
  SIDEBAR_FOOTER_HEIGHT,
} from "@/components/layout/sidebar-footer"

// Match `<Sidebar>`'s body padding so the chat list sits clear of
// the absolute-positioned footer + its gradient fade.
const BODY_BOTTOM_PAD = SIDEBAR_FOOTER_HEIGHT + SIDEBAR_FOOTER_FADE

/**
 * Default-exported component view for the `"agent"` left-sidebar
 * tab. Registered as `rendering: "component"` by
 * `plugins/agent-sidebar/src/main/services/agent-sidebar.ts`, so it
 * runs in-process inside the host renderer realm.
 *
 * Layout: a split-button header, a `<ListNav>` scope wrapping the
 * chat list (flat for a single worktree, grouped per-worktree
 * otherwise), and an absolute-positioned footer overlay. Mirrors
 * the `<Sidebar>` primitive's own body+footer structure so the
 * visual rhythm is identical to the other left-sidebar tabs that
 * consume `bodyVariant="fill"`.
 *
 * Keyboard navigation comes entirely from `<ListNav id="agent-sidebar">`:
 * j/k/h/l/Ctrl+d/Ctrl+u/Space/Enter are auto-registered against the
 * host shortcut service with `when: "agent-sidebar"`, the cursor
 * store + highlight + scroll-into-view + collapse-step-out
 * behavior all live in the primitive. Per-row activate (open chat
 * vs toggle worktree group) is declared inline via `<ListNav.Leaf
 * onActivate>` and `<ListNav.Branch onToggle>`.
 */
export default function AgentSidebarView(_props: ViewComponentProps) {
  const activeRepo = useActiveRepo()
  const activeScopeId = useActiveScopeId()
  const activeChatId = useActiveChatId()
  const sidebarGroups = useSidebarGroups()
  const scopeRows = useScopeRows()
  const actions = useSidebarActions()
  const collapsedGroups = useWorktreeGroupCollapsed()
  const toggleWorktreeGroup = useToggleWorktreeGroupCollapsed()
  const dbClient = useDbClient()
  const windowId = useWindowId()
  const events = useEvents()
  const setSidebarOpen = useSetLeftSidebarOpen()
  const listNav = useListNav("agent-sidebar")

  // Cmd+0 — the global `app.focusSidebar` shortcut. The plugin
  // owns this rather than the host so the focus target lines up
  // with whichever left-sidebar tab is active. Opens the left
  // sidebar if it's currently collapsed, then routes focus into
  // this view's `<ListNav>` (which seeds the cursor on first
  // focus and starts the j/k bindings firing).
  useEffect(() => {
    const off = events.app.focusSidebar.subscribe(() => {
      setSidebarOpen(true)
      listNav.focus()
    })
    return () => off()
  }, [events, setSidebarOpen, listNav])

  const multiGroupVisible = sidebarGroups.length > 1

  const openCreateWorktreeFromSidebar = () => {
    const activeRow = scopeRows.find(r => r.scopeId === activeScopeId)
    const sourceRef =
      activeRow?.worktree?.branch ?? activeRow?.worktree?.headSha ?? null
    openCreateWorktreeDialog(sourceRef)
  }

  // Activating a chat row: select it in the active pane, then
  // route focus into the composer. We sequence the focus via
  // `.then(…)` so the composer's EditorView is remounted under
  // the new chat id by the time the focus request lands (same
  // reason the legacy `sidebarActivateRow` did).
  const openChat = (chatId: string) => {
    void dbClient
      .update(root => {
        if (focusPaneShowingChatInRoot(root, windowId, chatId)) return
        selectChatInRoot(root, windowId, chatId)
      })
      .then(() => {
        requestFocusComposer(chatId)
      })
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden text-[13px]">
      <div
        className="shrink-0 px-1.5 pb-1 pt-1"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <NewChatSplitButton
          onNewChat={() => actions.handleNewChat()}
          onCreateWorktree={
            activeRepo ? openCreateWorktreeFromSidebar : undefined
          }
          onImportWorktrees={
            activeRepo ? actions.handleImportWorktrees : undefined
          }
          primaryAction="new-chat"
        />
      </div>

      <div
        className="relative min-h-0 flex-1"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <ListNav
          id="agent-sidebar"
          label="Agent Sidebar"
          activeRowId={activeChatId ? `chat:${activeChatId}` : undefined}
          className="absolute inset-0 overflow-auto outline-none"
          style={{ paddingBottom: BODY_BOTTOM_PAD }}
        >
          <div className="px-1.5">
            {sidebarGroups.length === 0 ? null : sidebarGroups.length === 1 ? (
              // Single-worktree case: skip the group wrapper.
              sidebarGroups[0]!.chats.map(chat => (
                <ListNav.Leaf
                  key={chat.id}
                  id={`chat:${chat.id}`}
                  kind="chat"
                  onActivate={() => openChat(chat.id)}
                >
                  <ChatSidebarItem
                    chat={chat}
                    canArchive={sidebarGroups[0]!.chats.length > 1}
                  />
                </ListNav.Leaf>
              ))
            ) : (
              sidebarGroups.map(group => (
                <WorktreeBranch
                  key={group.scope.id}
                  scope={group.scope}
                  chats={group.chats}
                  multiGroupVisible={multiGroupVisible}
                  collapsed={collapsedGroups[group.scope.id] ?? false}
                  toggle={() => toggleWorktreeGroup(group.scope.id)}
                  openChat={openChat}
                />
              ))
            )}
          </div>
        </ListNav>
        <AgentSidebarFooter />
      </div>
    </div>
  )
}

// ---- worktree-group branch ----------------------------------------------
//
// Lifted out of the main view to keep the per-group aggregate
// computation localised: only the sessions belonging to *this*
// group are observed, so a sibling group streaming doesn't recommit
// this one (same property the prior `WorktreeGroupItem` had).

type Chat = ReturnType<typeof useSidebarGroups>[number]["chats"][number]
type Scope = ReturnType<typeof useSidebarGroups>[number]["scope"]

function WorktreeBranch({
  scope,
  chats,
  multiGroupVisible,
  collapsed,
  toggle,
  openChat,
}: {
  scope: Scope
  chats: Chat[]
  multiGroupVisible: boolean
  collapsed: boolean
  toggle: () => void
  openChat: (chatId: string) => void
}) {
  const rpc = useRpc()
  const activeChatId = useActiveChatId()
  const activeRepo = useActiveRepo()
  const actions = useSidebarActions()
  const contextMenus = useWorkspaceContextMenu()

  const aggregates = useDb(root => {
    let isStreaming = false
    let hasUnread = false
    let hasActive = false
    for (const chat of chats) {
      if (chat.id === activeChatId) hasActive = true
      if (chat.session.kind !== "ready") continue
      const s = root.app.sessions[chat.session.sessionId]
      if (!s) continue
      if (s.isStreaming) isStreaming = true
      if (!hasActive && activeChatId != null && chat.id !== activeChatId) {
        const active = root.app.chats[activeChatId]
        if (
          active?.session.kind === "ready" &&
          active.session.sessionId === chat.session.sessionId
        ) {
          hasActive = true
        }
      }
      if (chat.id !== activeChatId) {
        if (
          s.lastCompletedAt != null &&
          s.lastCompletedAt > (s.lastOpenedAt ?? 0)
        ) {
          hasUnread = true
        }
      }
    }
    return { isStreaming, hasUnread, hasActive }
  })

  return (
    <ListNav.Branch
      id={`group:${scope.id}`}
      kind="group"
      expanded={!collapsed}
      onToggle={toggle}
      className="mt-2 first:mt-0 flex flex-col"
      header={
        <WorktreeGroupRow
          label={worktreeGroupLabel(scope, activeRepo)}
          rightIndicator={
            scope.pluginName != null ? <WorktreeGroupPluginIcon /> : null
          }
          collapsed={collapsed}
          isStreaming={aggregates.isStreaming}
          isActiveChildCollapsed={aggregates.hasActive}
          hasUnread={aggregates.hasUnread}
          onToggle={toggle}
          onContextMenu={e =>
            contextMenus.handleWorktreeGroupContextMenu(scope, e)
          }
          pinned={scope.pinnedAt != null}
          pinSlot={
            multiGroupVisible ? (
              <WorktreeGroupPinButton
                pinned={scope.pinnedAt != null}
                onToggle={() => actions.toggleWorktreeScopePin(scope.id)}
              />
            ) : null
          }
          hoverActions={
            <>
              <ChatRowActionButton
                title="New chat in this worktree"
                onClick={() => actions.createChatInScope(scope.id)}
              >
                <ComposeIcon />
              </ChatRowActionButton>
              <ChatRowActionButton
                title="More"
                onClick={async e => {
                  const rect = (
                    e.currentTarget as HTMLButtonElement
                  ).getBoundingClientRect()
                  const { chosenId } = await rpc.app.contextMenu.show({
                    x: Math.round(rect.right),
                    y: Math.round(rect.bottom),
                    items: [
                      {
                        id: "archive",
                        label: "Archive worktree",
                        enabled: multiGroupVisible,
                      },
                    ],
                  })
                  if (chosenId === "archive") {
                    // Route through the confirmation dialog so the
                    // user gets a chance to also delete the
                    // worktree directory on disk.
                    openArchiveWorktreeDialog(scope.id)
                  }
                }}
              >
                <MoreIcon />
              </ChatRowActionButton>
            </>
          }
        />
      }
    >
      <div className="flex flex-col gap-px [&_.hg-row]:!pl-6">
        {chats.map(chat => (
          <ListNav.Leaf
            key={chat.id}
            id={`chat:${chat.id}`}
            kind="chat"
            onActivate={() => openChat(chat.id)}
          >
            <ChatSidebarItem chat={chat} canArchive={chats.length > 1} />
          </ListNav.Leaf>
        ))}
      </div>
    </ListNav.Branch>
  )
}
