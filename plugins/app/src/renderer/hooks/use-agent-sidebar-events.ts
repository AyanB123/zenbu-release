import { useEffect } from "react"
import { useDbClient, useEvents, useRpc } from "@zenbujs/core/react"
import type { SplitPaneResult } from "@/lib/window-state/types"
import { useWindowId } from "@/lib/window-state/window-id"
import { useSetWorkspaceRailOpen } from "@/lib/window-state/active-view"
import { useSetLeftSidebarOpen } from "@/lib/window-state/workspace-ui"
import { closeActivePaneInRoot, newChatInCurrentPaneInRoot, splitPaneNewChatInRoot, splitPaneSameSessionInRoot } from "@/lib/window-state/panes/splits"
import { openSettingsInRoot, openViewBySourceInRoot, openViewBySourceInWorkspaceInRoot, openViewInRoot } from "@/lib/window-state/panes/views"
import { useSidebarActions } from "./use-sidebar-actions"

/** Subscribes to all top-level events emitted by main-process
 * services and palette actions: view-open hooks, pane shortcuts,
 * tab-history navigation. Per-list keyboard-nav events live in
 * `<ListNav>` (from `@zenbu/ui/list-nav`); Cmd+1..9 in
 * `useFocusPaneShortcut`. */
export function useAgentSidebarEvents() {
  const events = useEvents()
  const rpc = useRpc()
  const dbClient = useDbClient()
  const windowId = useWindowId()
  const setSidebarOpen = useSetLeftSidebarOpen()
  const setWorkspaceRailOpen = useSetWorkspaceRailOpen()
  const actions = useSidebarActions()

  // Sidebar views call `rpc.app.fileTree.openFile` which emits this
  // event. We catch it here so the file lands in a new pane to the
  // right of the active one (or replaces the existing tab tagged
  // with the same source).
  useEffect(() => {
    const off = events.app.openFileInActivePane.subscribe(
      ({ directory, path }) => {
        void dbClient.update(root => {
          openViewBySourceInRoot(
            root,
            windowId,
            "file",
            "file-tree-sidebar",
            { directory, path },
          )
        })
      },
    )
    return off
  }, [events, dbClient, windowId])

  // Generic "open this view in the active pane" hatch for plugin
  // services. The view registry resolves `viewType` at iframe-mount
  // time, so this stays decoupled.
  useEffect(() => {
    const off = events.app.openViewInActivePane.subscribe(
      ({ viewType, source, args, placement }) => {
        void dbClient.update(root => {
          openViewBySourceInRoot(
            root,
            windowId,
            viewType,
            source,
            args,
            placement ?? "right",
          )
        })
      },
    )
    return off
  }, [events, dbClient, windowId])

  // ⌘, — fired by `app.openSettings` and the matching palette action.
  useEffect(() => {
    const off = events.app.openSettings.subscribe(payload => {
      void dbClient.update(root => {
        const args: Record<string, unknown> = {}
        if (payload.tab) args.tab = payload.tab
        if (payload.sectionId) args.sectionId = payload.sectionId
        openSettingsInRoot(root, windowId, args)
      })
    })
    return off
  }, [events, dbClient, windowId])
  /**
   * this is surprising to me we model this as an event if its purely a db update
   */

  // The `openDiffInActivePane` payload carries the originating
  // workspace + scope so we can route to that workspace's pane
  // state even when the window's currently-active workspace differs.
  useEffect(() => {
    const off = events.app.openDiffInActivePane.subscribe(
      ({ workspaceId, scopeId, directory, path }) => {
        void dbClient.update(root => {
          openViewBySourceInWorkspaceInRoot(
            root,
            windowId,
            workspaceId,
            scopeId,
            "git-diff",
            "git-tree-sidebar",
            { directory, path },
          )
        })
      },
    )
    return off
  }, [events, dbClient, windowId])

  // Tool-output side pane. Mirrors the `openDiffInActivePane`
  // pattern above: source `"chat-tool-output"` is the token that
  // makes a second click on a different tool-call card *replace*
  // the contents of the existing pane instead of stacking a new
  // split — one shared output pane, just like one shared diff pane.
  useEffect(() => {
    const off = events.app.openToolOutputInActivePane.subscribe(
      ({ workspaceId, scopeId, sessionId, toolCallId }) => {
        void dbClient.update(root => {
          openViewBySourceInWorkspaceInRoot(
            root,
            windowId,
            workspaceId,
            scopeId,
            "tool-output",
            "chat-tool-output",
            { sessionId, toolCallId },
          )
        })
      },
    )
    return off
  }, [events, dbClient, windowId])

  useEffect(() => {
    const off = events.app.openPullRequestsView.subscribe(
      ({ mode, prNumber, directory, openMode }) => {
        void dbClient.update(root => {
          openViewInRoot(root, windowId, "pull-requests", openMode, {
            mode,
            prNumber,
            directory,
          })
        })
      },
    )
    return off
  }, [events, dbClient, windowId])

  // Pane / split shortcuts. The main process emits these on ⌘/, ⌘⇧/,
  // and ⌘W; the renderer does the DB mutation + RPC follow-up here so
  // the helpers can read live pane state through the same dbClient.
  useEffect(() => {
    const offSidebar = events.app.toggleSidebar.subscribe(() => {
      setSidebarOpen(o => !o)
    })
    const offWorkspaceRail = events.app.toggleWorkspaceRail.subscribe(() => {
      setWorkspaceRailOpen(o => !o)
    })
    const offSame = events.app.splitPaneSameSession.subscribe(() => {
      let result: SplitPaneResult | null = null
      void dbClient
        .update(root => {
          result = splitPaneSameSessionInRoot(root, windowId)
        })
        .then(() => {
          if (result?.kind === "chat" && result.needsSession) {
            void rpc.app.sessions
              .createChatSession({
                scopeId: result.scopeId,
                chatId: result.chatId,
              })
              .catch(err =>
                console.error(
                  "[shortcuts] split-same-session createChatSession failed:",
                  err,
                ),
              )
          }
        })
    })
    const offNew = events.app.splitPaneNewChat.subscribe(() => {
      let result: SplitPaneResult | null = null
      void dbClient
        .update(root => {
          result = splitPaneNewChatInRoot(root, windowId)
        })
        .then(() => {
          if (result?.kind !== "chat") return
          void rpc.app.sessions
            .createChatSession({
              scopeId: result.scopeId,
              chatId: result.chatId,
            })
            .catch(err =>
              console.error(
                "[shortcuts] split-new-chat createChatSession failed:",
                err,
              ),
            )
        })
    })
    const offClose = events.app.closeActivePane.subscribe(() => {
      void dbClient.update(root => {
        closeActivePaneInRoot(root, windowId)
      })
    })
    const offNewInPane = events.app.newChatInCurrentPane.subscribe(() => {
      let result: SplitPaneResult | null = null
      void dbClient
        .update(root => {
          result = newChatInCurrentPaneInRoot(root, windowId)
        })
        .then(() => {
          if (result?.kind !== "chat") return
          void rpc.app.sessions
            .createChatSession({
              scopeId: result.scopeId,
              chatId: result.chatId,
            })
            .catch(err =>
              console.error(
                "[shortcuts] new-chat-in-current-pane createChatSession failed:",
                err,
              ),
            )
        })
    })
    return () => {
      offSidebar()
      offWorkspaceRail()
      offSame()
      offNew()
      offClose()
      offNewInPane()
    }
  }, [events, dbClient, rpc, windowId, setSidebarOpen, setWorkspaceRailOpen])

  // ⌘N — same behaviour as the sidebar's "New Chat" button.
  useEffect(() => {
    const off = events.app.newChatReplaceActive.subscribe(() => {
      actions.handleNewChat()
    })
    return off
  }, [events, actions.handleNewChat])
}
