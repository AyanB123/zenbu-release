import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { nanoid } from "nanoid"
import { Allotment, LayoutPriority, type AllotmentHandle } from "allotment"
import { useDb, useDbClient, useEvents, useRpc } from "@zenbujs/core/react"
import { TitleBar } from "./layout/title-bar"
import { TitleBarWorkspace } from "./layout/title-bar-workspace"
import { CommitButton } from "./title-bar/commit-button"
import { PlayButton } from "./title-bar/play-button"
import { WorkspaceRail, type WorkspaceRailEntry } from "./layout/workspace-rail"
import { Sidebar } from "./layout/sidebar"
import { SidebarHeaderRow } from "./layout/sidebar-header-row"
import { SidebarRow } from "./layout/sidebar-row"
import { NewChatSplitButton } from "./layout/new-chat-split-button"
import { ChatTreeRow } from "./layout/chat-tree-row"
import { WorktreeGroupRow } from "./layout/worktree-group-row"
import { BranchSummaryDialog } from "./chat/branch-summary-dialog"
import { CreateWorktreeDialog } from "./dialogs/create-worktree-dialog"
import { CreatePluginDialog } from "./dialogs/create-plugin-dialog"
import { SidebarToggle } from "./title-bar/sidebar-toggle"
import { UtilityIconButton } from "./title-bar/utility-icon-button"
import { ChatsHost } from "./layout/chats-host"
import { LeftSidebarTabBar } from "./layout/left-sidebar-tab-bar"
import { AgentSidebarFooter } from "./agent-sidebar-footer"
import { PiSessionsTreeSidebar } from "./layout/pi-sessions-tree-sidebar"
import { ExtraDirsSidebar } from "./layout/extra-dirs-sidebar"
import { BottomPanelBody } from "./bottom-panel/bottom-panel-body"
import { RightSidebarBody } from "./sidebar-views/right-sidebar"
import { RightSidebarToggle } from "./title-bar/right-sidebar-toggle"
import { useSidebarViews } from "@/lib/sidebar-views"
import { useBottomPanelViews } from "@/lib/bottom-panel-views"
import {
  useClearWorkspaceIcon,
  useUploadWorkspaceIcon,
} from "@/lib/workspace-icon"
import {
  closeActivePaneInRoot,
  focusPaneShowingChatInRoot,
  newChatInCurrentPaneInRoot,
  openChatInNewPaneInRoot,
  openChatInNewTabInRoot,
  openViewBySourceInRoot,
  openViewBySourceInWorkspaceInRoot,
  openViewInRoot,
  selectChatInRoot,
  splitPaneNewChatInRoot,
  splitPaneSameSessionInRoot,
  stepActiveTabHistoryInRoot,
  useActiveChatId,
  useActiveScopeId,
  useActiveWorkspaceId,
  useSelectChat,
  useSelectWorkspace,
  useToggleWorktreeGroupCollapsed,
  useWindowId,
  useWorktreeGroupCollapsed,
  useLeftSidebarTab,
  useSetLeftSidebarTab,
  useBottomPanelView,
  useSetBottomPanelView,
  useLeftSidebarOpen,
  useSetLeftSidebarOpen,
  useWorkspaceRailOpen,
  useSetWorkspaceRailOpen,
  useActiveView,
  useShowOnboardingView,
  useRightSidebarOpenType,
  useRightSidebarLastType,
  useSetRightSidebarOpenType,
  useBottomPanelOpen,
  useSetBottomPanelOpen,
  useWorkspaceLayout,
  useSetWorkspaceLayout,
  type SplitPaneResult,
} from "@/lib/window-state"
import { useImportWorktrees } from "../hooks/use-import-worktrees"
import type { Schema } from "../../main/schema"
import { useSummary } from "../hooks/use-summary"
import { useCreateWorktreeDialog } from "../hooks/use-create-worktree-dialog"
import { EmptyWorkspaceScreen } from "./empty-workspace-screen"
import { ErrorBoundary } from "./common/error-boundary"
import { requestFocusComposer } from "@/lib/focus-composer"
import { cn } from "@/lib/utils"

type Chat = Schema["chats"][string]
type Session = Schema["sessions"][string]
type Scope = Schema["scopes"][string]
type Workspace = Schema["workspaces"][string]
type Repo = Schema["repos"][string]
type Worktree = Repo["worktrees"][number]

const DEFAULT_SIDEBAR_WIDTH = 220
const SNAP_SIDEBAR_WIDTH = 160
const DEFAULT_RIGHT_SIDEBAR_WIDTH = 320
const SNAP_RIGHT_SIDEBAR_WIDTH = 160
const DEFAULT_TERMINAL_HEIGHT = 260
const SNAP_TERMINAL_HEIGHT = 80

export type AgentSidebarPaneProps = {
  onOpenSettings: () => void
}

type ScopeRow = {
  /** Stable React key. scope.id when materialized, else worktree.path. */
  key: string
  /** Existing scope id when one has been materialized. */
  scopeId: string | null
  /** Directory the scope refers to (or would refer to once materialized). */
  directory: string
  /** Optional repo + worktree metadata for derived display. */
  worktree: Worktree | null
}

export function AgentSidebarPane({ onOpenSettings }: AgentSidebarPaneProps) {
  const rpc = useRpc()
  const events = useEvents()
  const dbClient = useDbClient()
  const windowId = useWindowId()
  const activeWorkspaceId = useActiveWorkspaceId()
  const activeScopeId = useActiveScopeId()
  const activeChatId = useActiveChatId()
  const selectWorkspace = useSelectWorkspace()
  const selectChat = useSelectChat()
  const collapsedGroups = useWorktreeGroupCollapsed()
  const toggleWorktreeGroup = useToggleWorktreeGroupCollapsed()
  const importWorktrees = useImportWorktrees()
  const leftSidebarTab = useLeftSidebarTab()
  const setLeftSidebarTab = useSetLeftSidebarTab()
  const sidebarOpen = useLeftSidebarOpen()
  const setSidebarOpen = useSetLeftSidebarOpen()
  const workspaceRailOpen = useWorkspaceRailOpen()
  const setWorkspaceRailOpen = useSetWorkspaceRailOpen()
  const activeView = useActiveView()
  const showOnboardingView = useShowOnboardingView()
  // Per-workspace sash positions, read straight from the db. The
  // hook is scoped by the active workspace id (and the window id),
  // so switching workspaces in the rail flips `workspaceLayout` to
  // the new entry on the next render. `null` fields mean "never
  // saved" — we fall back to the constants below.
  //
  // Writes happen on `onDragEnd` (one row per drag, not per frame)
  // because `onChange` would also fire for our own imperative
  // `resize(...)` calls during a workspace switch — see the long
  // comment on the workspace-switch effect below.
  const workspaceLayout = useWorkspaceLayout()
  const setWorkspaceLayout = useSetWorkspaceLayout()
  const sidebarWidth = workspaceLayout.sidebarWidth ?? DEFAULT_SIDEBAR_WIDTH
  const sidebarViews = useSidebarViews()
  const bottomPanelViews = useBottomPanelViews()
  const persistedBottomPanelView = useBottomPanelView()
  const setBottomPanelView = useSetBottomPanelView()
  // Resolve the active bottom-panel view: persisted choice when it's
  // still registered, otherwise fall back to the first available view
  // (which is `terminal` until a plugin contributes another one).
  const activeBottomPanelView = useMemo(() => {
    if (
      persistedBottomPanelView &&
      bottomPanelViews.some(v => v.type === persistedBottomPanelView)
    ) {
      return persistedBottomPanelView
    }
    return bottomPanelViews[0]?.type ?? null
  }, [bottomPanelViews, persistedBottomPanelView])
  const rightSidebarWidth =
    workspaceLayout.rightSidebarWidth ?? DEFAULT_RIGHT_SIDEBAR_WIDTH
  const rightOpenType = useRightSidebarOpenType()
  // Remember the last view the user picked, so closing+reopening the
  // sidebar via the title-bar toggle restores it instead of always
  // landing on the first registered view.
  const lastRightType = useRightSidebarLastType()
  const setRightOpenType = useSetRightSidebarOpenType()
  const isRightBodyOpen = rightOpenType != null && sidebarViews.length > 0

  const onRightSelectType = useCallback(
    (type: string) => {
      setRightOpenType(type)
    },
    [setRightOpenType],
  )

  const onRightToggle = useCallback(() => {
    if (rightOpenType != null) {
      setRightOpenType(null)
      return
    }
    if (sidebarViews.length === 0) return
    const restore =
      (lastRightType && sidebarViews.some(v => v.type === lastRightType)
        ? lastRightType
        : null) ?? sidebarViews[0]?.type ?? null
    if (restore) {
      setRightOpenType(restore)
    }
  }, [rightOpenType, sidebarViews, lastRightType, setRightOpenType])

  // Cmd/Ctrl+G toggles the right sidebar, mirroring Cmd/Ctrl+B for the left.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "g") {
        event.preventDefault()
        onRightToggle()
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [onRightToggle])

  const terminalOpen = useBottomPanelOpen()
  const setTerminalOpen = useSetBottomPanelOpen()
  const terminalHeight =
    workspaceLayout.terminalHeight ?? DEFAULT_TERMINAL_HEIGHT
  const {
    open: createWorktreeOpen,
    setOpen: setCreateWorktreeOpen,
    sourceRef: createWorktreeSourceRef,
    openDialog: openCreateWorktreeDialog,
  } = useCreateWorktreeDialog()
  // The "Create Plugin" action lives behind the New Chat split button
  // dropdown but only on the sentinel workspace. State is colocated
  // here so the dialog can reach the same db client / windowId we use
  // to focus the materialized chat once the pipeline succeeds.
  const [createPluginOpen, setCreatePluginOpen] = useState(false)
  // Refs into the three Allotments that compose the shell layout.
  // We need handles on all of them so a workspace switch can
  // imperatively move the sashes (preferredSize prop changes are
  // ignored on already-mounted views by Allotment).
  const outerAllotmentRef = useRef<AllotmentHandle>(null)
  const verticalAllotmentRef = useRef<AllotmentHandle>(null)
  const innerAllotmentRef = useRef<AllotmentHandle>(null)
  // Latest total dimensions for each Allotment, captured from
  // their respective `onChange`s. We need the totals to compute
  // the "other pane" size when imperatively resizing (resize()
  // takes absolute sizes for every pane).
  const outerTotalWidthRef = useRef(0)
  const verticalTotalHeightRef = useRef(0)
  const innerTotalWidthRef = useRef(0)

  // Reset the cached totals whenever the Allotments are not mounted
  // (onboarding view, or no workspaces exist yet). The totals are
  // only ever populated from each Allotment's `onChange`, so without
  // this reset they keep their last live measurement from before
  // onboarding. On the way back to workspace mode the workspace-
  // switch effect and the inner-re-resize effect would then see
  // `total > 0`, treat that as "we have a live size to resize
  // against", and call `handle.resize([...])` on a freshly remounted
  // Allotment whose internal view bookkeeping has not finished
  // reconciling — producing
  // `Cannot read properties of undefined (reading 'minimumSize')`
  // from inside `Splitview.resizeViews`. Clearing the refs here makes
  // the existing `total <= 0` guards correctly recognise the remount
  // as a first-paint and defer to each pane's `preferredSize={...}`
  // for the initial layout instead.
  const hasAnyWorkspace = useDb(
    root => Object.keys(root.app.workspaces).length > 0,
  )
  const allotmentsMounted =
    hasAnyWorkspace && activeView.kind !== "onboarding"
  useLayoutEffect(() => {
    if (allotmentsMounted) return
    outerTotalWidthRef.current = 0
    verticalTotalHeightRef.current = 0
    innerTotalWidthRef.current = 0
  }, [allotmentsMounted])

  // When the right body pane is added or removed, Allotment internally
  // calls `addView(Sizing.Distribute)` which equalises every pane to
  // ~total/N, then only resizes the new pane back to its preferred size.
  // That leaves the chat content inflated. Re-apply the desired layout
  // here, after Allotment's own layout effect, before paint.
  useLayoutEffect(() => {
    const handle = innerAllotmentRef.current
    const total = innerTotalWidthRef.current
    if (!handle || total <= 0) return
    if (isRightBodyOpen) {
      const right = rightSidebarWidth
      const content = Math.max(0, total - right)
      handle.resize([content, right])
    } else {
      handle.resize([total])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRightBodyOpen])

  // Workspace OR scope switch: imperatively move every shell sash
  // to the new identity's saved position. `preferredSize` prop
  // updates alone don't move anything — Allotment stores the new
  // value but only consults it on mount / visibility-restore — so
  // we drive sash positions through `ref.current.resize(...)` here.
  //
  // The outer Allotment tracks the *workspace* (its sized pane is
  // the left sidebar, which is workspace-wide). The vertical and
  // inner Allotments track the *scope* (their sized panes are the
  // bottom panel and right sidebar, whose content already swaps
  // per scope via the iframe args). We fire on either id changing
  // and only resize the Allotments whose identity actually flipped.
  //
  // Skipped on the very first render: the Allotments' resize
  // observers haven't filled `*TotalRef` yet, so there's nothing
  // to resize against. `preferredSize={...}` on the panes already
  // seeds the first paint with the right values.
  //
  // We deliberately use `onDragEnd` (not `onChange`) below to
  // persist sizes: the imperative resize calls in this effect
  // would otherwise re-enter our own write path with the OLD
  // render's `onChange` closure (Allotment binds `onChange` in a
  // useEffect that runs after paint, while this useLayoutEffect
  // runs before paint). `onDragEnd` only fires on real user drags,
  // so that round-trip is impossible.
  const prevWorkspaceRef = useRef(activeWorkspaceId)
  const prevScopeRef = useRef(activeScopeId)
  useLayoutEffect(() => {
    const workspaceChanged = prevWorkspaceRef.current !== activeWorkspaceId
    const scopeChanged = prevScopeRef.current !== activeScopeId
    if (!workspaceChanged && !scopeChanged) return
    prevWorkspaceRef.current = activeWorkspaceId
    prevScopeRef.current = activeScopeId

    if (workspaceChanged) {
      const outerTotal = outerTotalWidthRef.current
      if (outerTotal > 0 && sidebarOpen) {
        outerAllotmentRef.current?.resize([
          sidebarWidth,
          Math.max(0, outerTotal - sidebarWidth),
        ])
      }
    }
    if (workspaceChanged || scopeChanged) {
      const verticalTotal = verticalTotalHeightRef.current
      if (verticalTotal > 0 && terminalOpen) {
        verticalAllotmentRef.current?.resize([
          Math.max(0, verticalTotal - terminalHeight),
          terminalHeight,
        ])
      }
      const innerTotal = innerTotalWidthRef.current
      if (innerTotal > 0 && isRightBodyOpen) {
        innerAllotmentRef.current?.resize([
          Math.max(0, innerTotal - rightSidebarWidth),
          rightSidebarWidth,
        ])
      }
    }
  }, [
    activeWorkspaceId,
    activeScopeId,
    sidebarOpen,
    terminalOpen,
    isRightBodyOpen,
    sidebarWidth,
    rightSidebarWidth,
    terminalHeight,
  ])

  useEffect(() => {
    const off = events.app.toggleTerminal.subscribe(() => {
      setTerminalOpen(o => !o)
    })
    return off
  }, [events])

  // Pull focus into the terminal iframe whenever the bottom panel
  // opens, and *push it back out* whenever the panel closes. Two
  // facts make this the right place for this code:
  //
  //   1. Cmd+J is intercepted in the *main* process'
  //      `before-input-event` handler, which `preventDefault()`s the
  //      keydown before it ever reaches the renderer. The iframe
  //      therefore has no recent user activation — every
  //      `window.focus()` / `contentWindow.focus()` call *from
  //      inside* the iframe is silently rejected by Chrome.
  //
  //   2. Parent→child `iframeEl.focus()` (the DOM API on the
  //      `<iframe>` element itself) is **not** gated by user
  //      activation. It just moves the parent document's
  //      `activeElement` onto the iframe. The iframe's `window`
  //      then receives a `focus` event, and the iframe-side code
  //      listens for that and routes focus to its inner term.
  //
  // On open we wait one `requestAnimationFrame` so Allotment can
  // commit the pane's transition from hidden → visible — a
  // `display:none` iframe isn't focusable, but a 0-sized visible
  // iframe is, so as long as the layout pass has run we're fine.
  //
  // On close we have to actively `blur()` the iframe and refocus
  // the parent shell. Allotment's `visible={false}` just collapses
  // the pane's size; the iframe element stays in the DOM and
  // remains `document.activeElement`. Without this, the (now
  // hidden) terminal iframe's webContents keeps receiving every
  // keystroke — so any shortcut wired purely as a parent-window
  // `keydown` listener (Cmd+G for the right sidebar, the command
  // palette's capture-phase Esc, find-in-chat, etc.) never fires.
  // Shortcuts routed through the main process'
  // `before-input-event` bus still work either way, which is why
  // Cmd+J itself reopens the panel just fine but everything else
  // looks dead until you click somewhere outside the (invisible)
  // terminal.
  const wasTerminalOpenRef = useRef(terminalOpen)
  useEffect(() => {
    const wasOpen = wasTerminalOpenRef.current
    wasTerminalOpenRef.current = terminalOpen
    if (wasOpen === terminalOpen) return
    if (terminalOpen) {
      const raf = requestAnimationFrame(() => {
        const iframe = document.querySelector<HTMLIFrameElement>(
          'iframe[src*="type=terminal"]',
        )
        iframe?.focus()
      })
      return () => cancelAnimationFrame(raf)
    }
    const iframe = document.querySelector<HTMLIFrameElement>(
      'iframe[src*="type=terminal"]',
    )
    // Only steal focus back if it was actually parked on the
    // terminal iframe — we don't want to yank focus out of, say,
    // the composer just because the user toggled the panel shut
    // with a button click.
    if (iframe && document.activeElement === iframe) {
      iframe.blur()
      window.focus()
    }
  }, [terminalOpen])

  // Sidebar views call `rpc.app.fileTree.openFile`, which emits this
  // event. The main shell owns the pane layout, so we catch the event
  // here and slot the `file` view into a brand-new pane to the right
  // of the active one — the file lands next to whatever you were
  // already looking at (chat or another file) instead of fighting for
  // a tab slot in the same pane.
  // Both `openFileInActivePane` and `openDiffInActivePane` use the
  // "open or replace by source" convention: each sidebar tags its
  // tab with a stable source string so a second click from the
  // *same* sidebar reuses the existing tab rather than spawning
  // another split. Different sources still split into their own
  // panes, so file previews and diffs can coexist side-by-side.
  useEffect(() => {
    const off = events.app.openFileInActivePane.subscribe(({ directory, path }) => {
      void dbClient.update(root => {
        openViewBySourceInRoot(
          root,
          windowId,
          "file",
          "file-tree-sidebar",
          { directory, path },
        )
      })
    })
    return off
  }, [events, dbClient, windowId])

  // Generic "open this view in the active pane" hatch. Any plugin
  // service can emit `openViewInActivePane` to ask the shell to
  // embed one of its views without the host needing to know about
  // the view type ahead of time. The view registry resolves
  // `viewType` at iframe-mount time, so this stays decoupled.
  useEffect(() => {
    const off = events.app.openViewInActivePane.subscribe(({ viewType, source, args }) => {
      void dbClient.update(root => {
        openViewBySourceInRoot(root, windowId, viewType, source, args)
      })
    })
    return off
  }, [events, dbClient, windowId])

  // The `openDiffInActivePane` payload carries the *originating*
  // workspace + scope (turn-summary cards know which chat they belong
  // to; the git-tree sidebar reads them off its active scope), so we
  // route through `openViewBySourceInWorkspaceInRoot` instead of
  // letting the shell fall back to the window's currently-active
  // workspace. That fallback was the bug behind "click turn-summary
  // → workspace silently switches": with two workspaces open in the
  // same window, the active one could easily differ from the chat's
  // own workspace by the time the event reached this handler.
  useEffect(() => {
    const off = events.app.openDiffInActivePane.subscribe(
      ({ workspaceId: targetWorkspaceId, scopeId, directory, path }) => {
        void dbClient.update(root => {
          openViewBySourceInWorkspaceInRoot(
            root,
            windowId,
            targetWorkspaceId,
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

  // Palette / chat-advice / etc. emit `openPullRequestsView` to
  // land us on the Pull Requests view. The event carries the host
  // open mode (`new-tab` / `split-right` / `replace`) so the same
  // event can power both the palette entries and any future
  // service-side triggers without each caller re-implementing the
  // pane placement. The service has already started prefetching by
  // the time this fires, so the iframe usually mounts against a
  // warm cache.
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
  // and ⌘W (see `services/shortcuts.ts`); the renderer does the DB
  // mutation + any RPC follow-up here so the helpers can read live
  // pane state through the same `dbClient`.
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
    // ⌘[ / ⌘] walk the active tab's per-tab navigation history.
    // Always a pure DB update — no follow-up RPC — because back/
    // forward only moves the cursor inside the existing
    // `tab.history.entries`, it never creates a new chat or view.
    const offBack = events.app.tabHistoryBack.subscribe(() => {
      void dbClient.update(root => {
        stepActiveTabHistoryInRoot(root, windowId, -1)
      })
    })
    const offForward = events.app.tabHistoryForward.subscribe(() => {
      void dbClient.update(root => {
        stepActiveTabHistoryInRoot(root, windowId, 1)
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
      offBack()
      offForward()
    }
  }, [events, dbClient, rpc, windowId, setSidebarOpen, setWorkspaceRailOpen])

  const workspaces = useDb(root => Object.values(root.app.workspaces))
  const scopes = useDb(root => Object.values(root.app.scopes))
  const chats = useDb(root => Object.values(root.app.chats))
  const sessionsById = useDb(root => root.app.sessions)
  const reposById = useDb(root => root.app.repos)
  const sessionMetaById = useDb(root => root.app.sessionMeta)
  // ^ also feeds `useSummary` inside `ChatSidebarItem`. The sort key
  // below pulls `lastMessageSentTime` out of the same record.
  const sidebarChatSort = useDb(root => root.app.settings.sidebarChatSort)

  const scopesInWorkspace = useMemo(
    () =>
      activeWorkspaceId
        ? scopes
            .filter(s => s.workspaceId === activeWorkspaceId)
            .sort((a, b) => b.createdAt - a.createdAt)
        : [],
    [scopes, activeWorkspaceId],
  )

  const activeRepoId =
    scopesInWorkspace.find(s => s.repoId != null)?.repoId ?? null
  const activeRepo: Repo | null = activeRepoId
    ? reposById[activeRepoId] ?? null
    : null

  const scopeRows = useMemo<ScopeRow[]>(() => {
    if (!activeWorkspaceId) return []
    const scopeByDir = new Map<string, Scope>(
      scopesInWorkspace.map(s => [s.directory, s]),
    )
    const out: ScopeRow[] = []
    const consumed = new Set<string>()
    if (activeRepo) {
      for (const wt of activeRepo.worktrees) {
        const scope = scopeByDir.get(wt.path) ?? null
        out.push({
          key: wt.path,
          scopeId: scope?.id ?? null,
          directory: wt.path,
          worktree: wt,
        })
        if (scope) consumed.add(scope.id)
      }
    }
    for (const scope of scopesInWorkspace) {
      if (consumed.has(scope.id)) continue
      out.push({
        key: scope.id,
        scopeId: scope.id,
        directory: scope.directory,
        worktree: null,
      })
    }
    return out
  }, [activeWorkspaceId, scopesInWorkspace, activeRepo])

  // Build the worktree-group listing for the active workspace.
  // Heuristic: a worktree (scope) only appears if it has at least
  // one non-archived chat. Within each group, chats are deduplicated
  // by sessionId (multiple chats can share a session after
  // ⌘/ split-with-same-session) and sorted by the user's chosen
  // sidebar sort key.
  const sidebarGroups = useMemo(() => {
    if (!activeWorkspaceId) return []
    const sortKey = (c: Chat) => {
      if (sidebarChatSort === "created") return c.createdAt
      if (c.session.kind !== "ready") return c.createdAt
      return (
        sessionMetaById[c.session.sessionId]?.lastMessageSentTime ??
        c.createdAt
      )
    }

    // Index non-archived, non-completed scopes in this workspace,
    // keyed by id. Archived and completed scopes are soft-hidden
    // from the sidebar; their chats keep working (they remain
    // available as tabs and via the agents palette) but don't
    // render as a group here — they live in the footer popover
    // instead.
    const wsScopes = scopes.filter(
      s =>
        s.workspaceId === activeWorkspaceId &&
        !s.archived &&
        !s.completed,
    )
    const scopeById = new Map(wsScopes.map(s => [s.id, s] as const))

    // Bucket chats by scopeId, deduping by sessionId.
    type Group = { scope: Scope; chats: Chat[]; isStreaming: boolean }
    const buckets = new Map<string, Chat[]>()
    const oldestFirstChats = chats.slice().sort((a, b) => a.createdAt - b.createdAt)
    const seenSessions = new Set<string>()
    for (const chat of oldestFirstChats) {
      if (!scopeById.has(chat.scopeId)) continue
      if (chat.session.kind === "ready") {
        const sid = chat.session.sessionId
        if (seenSessions.has(sid)) continue
        if (sessionsById[sid]?.archived) continue
        seenSessions.add(sid)
      }
      const arr = buckets.get(chat.scopeId) ?? []
      arr.push(chat)
      buckets.set(chat.scopeId, arr)
    }

    const out: Group[] = []
    for (const [scopeId, groupChats] of buckets) {
      const scope = scopeById.get(scopeId)
      if (!scope) continue
      const isStreaming = groupChats.some(
        c =>
          c.session.kind === "ready" &&
          sessionsById[c.session.sessionId]?.isStreaming,
      )
      const sorted = groupChats.slice().sort((a, b) => sortKey(b) - sortKey(a))
      out.push({ scope, chats: sorted, isStreaming })
    }
    // Group order: pinned scopes first, then unpinned. Within each
    // bucket the sort key is a wall-clock timestamp, descending.
    //
    //   pinned   → `pinnedAt` (most recently pinned bubbles up;
    //              the implicitly-pinned main worktree, which
    //              uses createdAt as its pinnedAt, naturally sits
    //              at the bottom of the pinned section).
    //   unpinned → `max(unpinnedAt ?? 0, createdAt)` so a freshly-
    //              unpinned scope appears at the top of the
    //              unpinned section instead of dropping to the
    //              bottom (which would feel like the user just
    //              lost it). Freshly-created scopes also bubble
    //              up because their createdAt is the most recent
    //              value either way.
    //
    // We deliberately do NOT honor `sidebarChatSort` at the group
    // level — that preference applies to chats inside a group;
    // reordering groups on every new message would be confusing.
    const pinnedKey = (s: Scope) => s.pinnedAt ?? 0
    const unpinnedKey = (s: Scope) =>
      Math.max(s.unpinnedAt ?? 0, s.createdAt)
    out.sort((a, b) => {
      const aPinned = a.scope.pinnedAt != null
      const bPinned = b.scope.pinnedAt != null
      if (aPinned !== bPinned) return aPinned ? -1 : 1
      const keyA = aPinned ? pinnedKey(a.scope) : unpinnedKey(a.scope)
      const keyB = bPinned ? pinnedKey(b.scope) : unpinnedKey(b.scope)
      if (keyA !== keyB) return keyB - keyA
      // Stable tiebreaker for batch-imported worktrees so the
      // order is deterministic across reloads.
      return a.scope.directory.localeCompare(b.scope.directory)
    })
    return out
  }, [
    activeWorkspaceId,
    activeScopeId,
    chats,
    scopes,
    sessionsById,
    sessionMetaById,
    sidebarChatSort,
  ])

  // Flat list of session rows in the active scope, used by
  // `archiveChat` (it needs to know the row count to decide whether
  // to refuse archiving the last row in a scope).
  const sessionRowsInSelectedScope = useMemo(() => {
    const group = sidebarGroups.find(g => g.scope.id === activeScopeId)
    return group?.chats ?? []
  }, [sidebarGroups, activeScopeId])

  const activeScope = useMemo(
    () =>
      activeScopeId
        ? scopes.find(s => s.id === activeScopeId) ?? null
        : null,
    [activeScopeId, scopes],
  )

  const activeWorkspace = useMemo(
    () =>
      activeWorkspaceId
        ? workspaces.find(w => w.id === activeWorkspaceId) ?? null
        : null,
    [activeWorkspaceId, workspaces],
  )

  // Sentinel workspaces (currently just the built-in self-edit entry
  // created by `SentinelWorkspaceService`) live in a *separate* fixed
  // slot at the very bottom of the rail, directly above the settings
  // button — not inside the main scrollable list. Keeping the lists
  // physically separate means new user workspaces (which sort
  // most-recent-first) can never push the sentinel out of place, and
  // the user always finds "edit the IDE" in the same spot.
  const railEntry = (w: Workspace): WorkspaceRailEntry => ({
    id: w.id,
    label: workspaceLabel(w),
    icon: w.icon ?? null,
    hasActivity: chats.some(
      c =>
        scopeForChat(c.scopeId, scopes)?.workspaceId === w.id &&
        c.session.kind === "ready" &&
        sessionsById[c.session.sessionId]?.isStreaming,
    ),
  })
  const rail = useMemo(
    () =>
      workspaces
        .slice()
        .filter(w => !w.archived && !w.sentinel)
        .sort((a, b) => b.createdAt - a.createdAt)
        .map(railEntry),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [workspaces, chats, sessionsById, scopes],
  )
  const pinnedBottomRail = useMemo(
    () =>
      workspaces
        .slice()
        .filter(w => !w.archived && w.sentinel)
        .sort((a, b) => a.createdAt - b.createdAt)
        .map(railEntry),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [workspaces, chats, sessionsById, scopes],
  )

  const uploadWorkspaceIcon = useUploadWorkspaceIcon()
  const clearWorkspaceIcon = useClearWorkspaceIcon()

  const pickWorkspaceIconFile = useCallback(
    (workspaceId: string) => {
      const input = document.createElement("input")
      input.type = "file"
      input.accept =
        "image/png,image/jpeg,image/gif,image/webp,image/svg+xml,image/avif"
      input.onchange = () => {
        const file = input.files?.[0]
        if (!file) return
        void uploadWorkspaceIcon(workspaceId, file).catch(err =>
          console.error("[workspace-icon] upload failed:", err),
        )
      }
      input.click()
    },
    [uploadWorkspaceIcon],
  )

  // Right-click on the rail background (i.e. not on a workspace
  // item) shows a single-action native menu so the user can hide
  // the rail without the default Chromium menu showing up. The
  // label spells out the unhide shortcut so the dismissal isn't a
  // dead-end.
  const handleRailBackgroundContextMenu = useCallback(
    async (e: React.MouseEvent) => {
      const { chosenId } = await rpc.app.contextMenu.show({
        x: e.clientX,
        y: e.clientY,
        items: [
          {
            id: "hide-rail",
            label: "Hide (Unhide with ⌘⇧B)",
          },
        ],
      })
      if (chosenId === "hide-rail") {
        setWorkspaceRailOpen(false)
      }
    },
    [rpc, setWorkspaceRailOpen],
  )

  const handleWorkspaceContextMenu = useCallback(
    async (workspaceId: string, e: React.MouseEvent) => {
      const ws = workspaces.find(w => w.id === workspaceId)
      const hasIcon = ws?.icon != null
      // Sentinel workspaces are the built-in self-edit entry — they
      // cannot be archived or deleted through the normal UI. The
      // user can still re-skin them via Set/Replace/Clear icon.
      const isSentinel = ws?.sentinel === true
      const { chosenId } = await rpc.app.contextMenu.show({
        x: e.clientX,
        y: e.clientY,
        items: [
          {
            id: "set-icon",
            label: hasIcon ? "Replace icon…" : "Set icon…",
          },
          {
            id: "clear-icon",
            label: "Clear icon",
            enabled: hasIcon,
          },
          ...(isSentinel
            ? []
            : [
                { type: "separator" as const },
                {
                  id: "archive",
                  label: ws?.archived
                    ? "Unarchive workspace"
                    : "Archive workspace",
                },
                {
                  id: "delete",
                  label: "Delete workspace",
                },
              ]),
        ],
      })
      if (isSentinel && (chosenId === "archive" || chosenId === "delete")) {
        // Defensive: the menu doesn't even include these for
        // sentinels, but if some other caller manages to dispatch
        // them we still refuse.
        console.warn(
          "[sidebar] refusing to archive/delete the sentinel workspace",
        )
        return
      }
      if (chosenId === "archive") {
        const wsScopeIds = scopes
          .filter(s => s.workspaceId === workspaceId)
          .map(s => s.id)
        const wsScopeSet = new Set(wsScopeIds)
        await dbClient.update(root => {
          const target = root.app.workspaces[workspaceId]
          if (!target) return
          const nextArchived = !target.archived
          target.archived = nextArchived
          if (nextArchived) {
            for (const win of Object.values(root.app.windowStates)) {
              if (
                win.selectedScopeId &&
                wsScopeSet.has(win.selectedScopeId)
              ) {
                win.selectedScopeId = null
              }
              // Don't touch `activeView` here. If the archived
              // workspace was the active one, `activeView` keeps
              // pointing at it; `App`'s boot effect notices the
              // workspace is no longer in the non-archived list
              // and auto-selects the next one (or drops to
              // onboarding when there are none left).
            }
          }
        })
      } else if (chosenId === "set-icon") {
        pickWorkspaceIconFile(workspaceId)
      } else if (chosenId === "clear-icon") {
        try {
          await clearWorkspaceIcon(workspaceId)
        } catch (err) {
          console.error("[workspace-icon] clear failed:", err)
        }
      } else if (chosenId === "delete") {
        const wsScopes = scopes.filter(s => s.workspaceId === workspaceId)
        const wsScopeIds = wsScopes.map(s => s.id)
        const wsScopeSet = new Set(wsScopeIds)
        const wsChats = chats.filter(c => wsScopeSet.has(c.scopeId))
        const wsSessionIds = wsChats
          .map(c => (c.session.kind === "ready" ? c.session.sessionId : null))
          .filter((id): id is string => id != null)

        for (const sessionId of wsSessionIds) {
          await rpc.app.sessions
            .deleteSession({ sessionId })
            .catch(err =>
              console.error("[sidebar] deleteSession failed:", err),
            )
        }

        await rpc.app.terminal
          .disposeForScopes({ scopeIds: wsScopeIds })
          .catch(err =>
            console.error("[sidebar] terminal.disposeForScopes failed:", err),
          )

        await dbClient.update(root => {
          delete root.app.workspaces[workspaceId]
          for (const scopeId of wsScopeIds) {
            delete root.app.scopes[scopeId]
          }
          for (const chat of wsChats) {
            delete root.app.chats[chat.id]
          }
          for (const ws of Object.values(root.app.windowStates)) {
            for (const scopeId of wsScopeIds) {
              delete ws.scopeLastTerminal[scopeId]
              delete ws.worktreeGroupCollapsed[scopeId]
            }
            if (ws.selectedScopeId && wsScopeSet.has(ws.selectedScopeId)) {
              ws.selectedScopeId = null
            }
            // Same as archive: leave `activeView` alone. After we
            // delete the workspace, `App`'s boot effect sees
            // `activeView.workspaceId` pointing at something that
            // no longer exists and reselects (or drops to
            // onboarding).
            delete ws.workspacePanes[workspaceId]
          }
        })
      }
    },
    [chats, clearWorkspaceIcon, dbClient, pickWorkspaceIconFile, rpc, scopes, workspaces],
  )

  const handleSelectWorkspace = useCallback(
    (workspaceId: string) => {
      selectWorkspace(workspaceId)
    },
    [selectWorkspace],
  )

  // The rail's "+" doesn't prompt for a directory directly
  // anymore — it routes the window to the onboarding view (a
  // small window-level "router" tracked in window state).
  // `EmptyWorkspaceScreen` owns the open-folder / clone-from-URL
  // flow, and `useCreateWorkspaceFromDirectory` flips `activeView`
  // back to `workspace` once a workspace exists.
  const handleAddWorkspace = useCallback(() => {
    showOnboardingView()
  }, [showOnboardingView])

  // Sidebar "New Chat" (and ⌘N): create a fresh chat and *replace*
  // the active tab's chat with it (no new tab). The EditorView is
  // reused across chat switches — it only auto-focuses on mount —
  // so after the swap we fire `focusComposer` for the new chat id
  // and the composer subscribes and refocuses. ⌘T (new tab) takes
  // a different path: it mounts a fresh composer which focuses on
  // its own.
  /**
   * Resolve the scope for a new chat created from the sidebar.
   * Prefers the active worktree (= active chat's scope) and falls
   * back to the workspace's earliest-created scope when nothing is
   * active yet.
   */
  const resolveNewChatScopeId = useCallback(
    (preferScopeId?: string | null): string | null => {
      if (preferScopeId) return preferScopeId
      if (activeScopeId) return activeScopeId
      if (!activeWorkspaceId) return null
      const wsScopes = scopes.filter(s => s.workspaceId === activeWorkspaceId)
      if (wsScopes.length === 0) return null
      return wsScopes.slice().sort((a, b) => a.createdAt - b.createdAt)[0]!.id
    },
    [activeScopeId, activeWorkspaceId, scopes],
  )

  const createChatInScope = useCallback(
    (scopeId: string) => {
      const chatId = nanoid()
      const now = Date.now()
      void dbClient
        .update(root => {
          root.app.chats[chatId] = {
            id: chatId,
            scopeId,
            session: { kind: "pending" },
            createdAt: now,
          }
          selectChatInRoot(root, windowId, chatId)
        })
        .then(() => {
          void rpc.app.sessions
            .createChatSession({ scopeId, chatId })
            .catch(err =>
              console.error("[sidebar] createChatSession failed:", err),
            )
          requestFocusComposer(chatId)
        })
    },
    [dbClient, rpc, windowId],
  )

  // Sidebar "New Chat" (and ⌘N): create a fresh chat in the active
  // worktree (or workspace's primary worktree if none) and replace
  // the active tab's chat with it.
  const handleNewChat = useCallback(() => {
    const scopeId = resolveNewChatScopeId()
    if (!scopeId) return
    createChatInScope(scopeId)
  }, [resolveNewChatScopeId, createChatInScope])

  // ⌘N — same behaviour as the sidebar's "New Chat" button.
  useEffect(() => {
    const off = events.app.newChatReplaceActive.subscribe(() => {
      handleNewChat()
    })
    return off
  }, [events, handleNewChat])

  // Click a chat in the sidebar. Prefer focusing an existing tab
  // that already shows this chat (so we don't clobber the active
  // tab in the destination workspace's pane state); otherwise
  // replace the active tab via `selectChatInRoot`.
  //
  // If the destination chat has a saved draft we also fire a
  // `requestFocusComposer` after the switch. The composer's
  // EditorView is reused across chat swaps and only auto-focuses
  // on mount, so without this nudge clicking the draft glyph would
  // land you on the chat with the draft visible but the cursor
  // still in the old composer. Reading the draft straight off the
  // local replica is fine — `useChatDraft` flushes synchronously
  // on unmount, so by the time the user clicks another row the
  // outgoing chat's draft has already landed in `chatStates`.
  const handleSelectChat = useCallback(
    (id: string) => {
      const destDraft =
        dbClient.readRoot().app.chatStates[id]?.draft ?? ""
      const hasDraft = destDraft.trim().length > 0
      void dbClient
        .update(root => {
          if (focusPaneShowingChatInRoot(root, windowId, id)) return
          selectChatInRoot(root, windowId, id)
        })
        .then(() => {
          if (hasDraft) requestFocusComposer(id)
        })
    },
    [dbClient, windowId],
  )



  // Archive a sidebar row (session or pending chat).
  //
  // Mirrors `closeTabInRoot` for tabs: when the archived row is the
  // active one we select the row below it; if there's nothing below,
  // we select the one above; if it's the only row left in scope we
  // refuse to archive at all so the sidebar never goes empty.
  const archiveChat = useCallback(
    (chat: Chat) => {
      const rows = sessionRowsInSelectedScope
      if (rows.length <= 1) return
      const idx = rows.findIndex(c => c.id === chat.id)
      const isActive = isChatActiveForSession(chat, activeChatId, chats)
      let nextChatId: string | null = null
      if (isActive && idx >= 0) {
        const next = rows[idx + 1] ?? (idx > 0 ? rows[idx - 1] : undefined)
        nextChatId = next?.id ?? null
      }
      void dbClient
        .update(root => {
          if (chat.session.kind === "ready") {
            const session = root.app.sessions[chat.session.sessionId]
            if (session) session.archived = true
          } else {
            delete root.app.chats[chat.id]
          }
          if (nextChatId) {
            selectChatInRoot(root, windowId, nextChatId)
          }
        })
        .then(() => {
          // Same EditorView reuse trap as the sidebar's New Chat
          // button: archiving swaps the active tab's chatId in
          // place, so the composer doesn't re-mount and doesn't
          // auto-focus. Nudge it explicitly.
          if (nextChatId) requestFocusComposer(nextChatId)
        })
    },
    [
      sessionRowsInSelectedScope,
      activeChatId,
      chats,
      dbClient,
      windowId,
    ],
  )

  // Soft-archive a worktree group. Flips `scope.archived = true`
  // so the group disappears from the sidebar; chats inside the
  // scope remain accessible as tabs and via the palette. Refuses
  // to archive the only remaining visible scope so the sidebar
  // never goes empty. Also stamps `archivedAt` so the
  // archived-worktrees footer popover can sort by
  // most-recently-archived without having to walk sessions.
  const archiveWorktreeScope = useCallback(
    (scopeId: string) => {
      const remainingGroups = sidebarGroups.filter(
        g => g.scope.id !== scopeId,
      )
      if (remainingGroups.length === 0) {
        console.warn(
          "[sidebar] refusing to archive the only visible worktree",
        )
        return
      }
      void dbClient.update(root => {
        const scope = root.app.scopes[scopeId]
        if (!scope) return
        scope.archived = true
        scope.archivedAt = Date.now()
        // If the scope was also marked completed, clear the
        // completed flag — a worktree only belongs in one of the
        // two footer buckets at a time, and the user's most
        // recent action wins.
        if (scope.completed) {
          scope.completed = false
          scope.completedAt = null
        }
      })
    },
    [dbClient, sidebarGroups],
  )

  // Mark a worktree group as completed. Same UX as archive (hides
  // the group from the sidebar; chats stay reachable through tabs
  // and the palette), but distinguished from archive so users can
  // visually separate "shelved" worktrees from "finished" ones in
  // the footer popover. Stamps `completedAt` for sortability and
  // refuses to hide the last visible scope, same as archive.
  const completeWorktreeScope = useCallback(
    (scopeId: string) => {
      const remainingGroups = sidebarGroups.filter(
        g => g.scope.id !== scopeId,
      )
      if (remainingGroups.length === 0) {
        console.warn(
          "[sidebar] refusing to complete the only visible worktree",
        )
        return
      }
      void dbClient.update(root => {
        const scope = root.app.scopes[scopeId]
        if (!scope) return
        scope.completed = true
        scope.completedAt = Date.now()
        if (scope.archived) {
          scope.archived = false
          scope.archivedAt = null
        }
      })
    },
    [dbClient, sidebarGroups],
  )

  // Toggle pinned state on a worktree group. Pinning stamps
  // `pinnedAt = now` and clears `unpinnedAt`; unpinning does the
  // reverse (stamps `unpinnedAt` so the row stays near the top of
  // the unpinned section instead of falling to the bottom, and
  // nulls out `pinnedAt`). All writes go through the local replica
  // — there's no async server work to wait on, so the row reorders
  // instantly on click.
  const toggleWorktreeScopePin = useCallback(
    (scopeId: string) => {
      void dbClient.update(root => {
        const scope = root.app.scopes[scopeId]
        if (!scope) return
        const now = Date.now()
        if (scope.pinnedAt != null) {
          scope.pinnedAt = null
          scope.unpinnedAt = now
        } else {
          scope.pinnedAt = now
          // We deliberately leave `unpinnedAt` alone so the
          // priority key for the unpinned bucket survives a
          // pin→unpin cycle (the row goes back where it was
          // before, not to the bottom).
        }
      })
    },
    [dbClient],
  )

  // Right-click on a worktree-group header in the new sidebar.
  // Currently exposes "Create worktree from this branch" — the same
  // action that lives on the split-button dropdown but pre-seeded
  // with this group's branch as the source ref.
  const handleWorktreeGroupContextMenu = useCallback(
    async (scope: Scope, e: React.MouseEvent) => {
      const wt = activeRepo?.worktrees.find(w => w.path === scope.directory)
      const branch = wt?.branch ?? null
      const headSha = wt?.headSha ?? null
      const { chosenId } = await rpc.app.contextMenu.show({
        x: e.clientX,
        y: e.clientY,
        items: [
          {
            id: "new-worktree",
            label: branch
              ? `New worktree from ${branch}…`
              : "New worktree from this HEAD…",
            enabled: !!(branch || headSha),
          },
        ],
      })
      if (chosenId === "new-worktree") {
        openCreateWorktreeDialog(branch ?? headSha)
      }
    },
    [activeRepo, openCreateWorktreeDialog, rpc],
  )

  const handleChatContextMenu = useCallback(
    async (chat: Chat, e: React.MouseEvent) => {
      const isReady = chat.session.kind === "ready"
      const { chosenId } = await rpc.app.contextMenu.show({
        x: e.clientX,
        y: e.clientY,
        items: [
          {
            id: "open_in_new_tab",
            label: "Open in new tab",
            enabled: true,
          },
          {
            id: "open_in_new_pane",
            label: "Open in split",
            enabled: true,
          },
          {
            id: "open_in_new_window",
            label: "Open in new window",
            enabled: true,
          },
          { type: "separator" },
          {
            id: "branch_last_user",
            label: "Branch from last user message",
            enabled: isReady,
          },
          {
            id: "fork",
            label: "Fork chat from latest entry",
            enabled: isReady,
          },
          { type: "separator" },
          {
            id: "archive",
            label: "Archive session",
            enabled: isReady && sessionRowsInSelectedScope.length > 1,
          },
        ],
      })
      if (chosenId === "archive") {
        archiveChat(chat)
        return
      }
      if (chosenId === "open_in_new_tab") {
        await dbClient.update(root => {
          openChatInNewTabInRoot(root, windowId, chat.id)
        })
        return
      }
      if (chosenId === "open_in_new_window") {
        try {
          await rpc.app.chatWindow.open({ chatId: chat.id })
        } catch (err) {
          console.error("[sidebar] chatWindow.open failed:", err)
        }
        return
      }
      if (chosenId === "open_in_new_pane") {
        await dbClient.update(root => {
          openChatInNewPaneInRoot(root, windowId, chat.id)
        })
        return
      }
      if (chat.session.kind !== "ready") return
      const sessionId = chat.session.sessionId
      if (chosenId === "branch_last_user") {
        try {
          const result = await rpc.app.sessions.branchFromLastUserTurn({
            sessionId,
          })
          if (!result.branched) {
            console.warn("[sidebar] nothing to branch from")
          }
        } catch (err) {
          console.error("[sidebar] branch failed:", err)
        }
      } else if (chosenId === "fork") {
        const session = sessionsById[sessionId]
        const entryId = session?.currentLeafEntryId
        if (!entryId) {
          console.warn("[sidebar] no leaf entry to fork from")
          return
        }
        try {
          const result = await rpc.app.sessions.fork({
            sessionId,
            entryId,
            workspaceId: activeWorkspaceId ?? "",
          })
          selectChat(result.chatId)
        } catch (err) {
          console.error("[sidebar] fork failed:", err)
        }
      }
    },
    [
      activeWorkspaceId,
      archiveChat,
      dbClient,
      rpc,
      selectChat,
      sessionRowsInSelectedScope.length,
      sessionsById,
      windowId,
    ],
  )

  // Branch-summary dialog state. When non-null, the BranchSummaryDialog
  // is open against the given entry; on confirm we forward the choice
  // to `rpc.app.sessions.navigateTree` and then close.
  const [branchPrompt, setBranchPrompt] = useState<{
    sessionId: string
    entryId: string
    label: string
  } | null>(null)
  const [branchPromptBusy, setBranchPromptBusy] = useState(false)

  const handleBranchPromptCancel = useCallback(() => {
    if (branchPromptBusy) return
    setBranchPrompt(null)
  }, [branchPromptBusy])

  const handleBranchPromptConfirm = useCallback(
    async (
      choice:
        | { kind: "none" }
        | { kind: "default" }
        | { kind: "custom"; customInstructions: string },
    ) => {
      if (!branchPrompt) return
      const { sessionId, entryId } = branchPrompt
      setBranchPromptBusy(true)
      try {
        await rpc.app.sessions.navigateTree({
          sessionId,
          entryId,
          summarize: choice.kind !== "none",
          customInstructions:
            choice.kind === "custom" ? choice.customInstructions : undefined,
        })
      } catch (err) {
        console.error("[sidebar] navigateTree failed:", err)
      } finally {
        setBranchPromptBusy(false)
        setBranchPrompt(null)
      }
    },
    [branchPrompt, rpc],
  )

  useEffect(() => {
    if (!rightOpenType) return
    if (!sidebarViews.some(v => v.type === rightOpenType)) {
      setRightOpenType(null)
    }
  }, [sidebarViews, rightOpenType, setRightOpenType])

  const handleCreateWorktreeAccordion = useCallback(() => {
    const activeRow = scopeRows.find(r => r.scopeId === activeScopeId)
    const sourceRef =
      activeRow?.worktree?.branch ?? activeRow?.worktree?.headSha ?? null
    console.log("[create-worktree] sidebar trigger", {
      activeScopeId,
      activeRepoId,
      sourceRef,
      scopeRowCount: scopeRows.length,
    })
    openCreateWorktreeDialog(sourceRef)
  }, [activeRepoId, activeScopeId, openCreateWorktreeDialog, scopeRows])

  // "Import Worktrees" split-button action: for each worktree of
  // the active repo without a chat, create scope (if missing) +
  // pending chat so every worktree shows up as a group in the
  // sidebar.
  const handleImportWorktrees = useCallback(async () => {
    if (!activeWorkspace || !activeRepo) return
    try {
      await importWorktrees(activeWorkspace, activeRepo)
    } catch (err) {
      console.error("[sidebar] import worktrees failed:", err)
    }
  }, [activeWorkspace, activeRepo, importWorktrees])

  return (
    <div
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-[10px] border bg-muted bg-clip-padding"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      <ErrorBoundary label="Title bar">
      {activeView.kind === "onboarding" ? (
        // Onboarding has no workspace context: the chat sidebar,
        // working area, commit button, and right-sidebar views
        // are all hidden, so none of the workspace title-bar
        // controls would do anything. Render a minimal bar that's
        // just a draggable surface with a centered label.
        <TitleBar label="New workspace" />
      ) : (
        <TitleBar
          left={
            <>
              <SidebarToggle
                open={sidebarOpen}
                onToggle={() => setSidebarOpen(o => !o)}
              />
            </>
          }
          center={
            activeWorkspace ? (
              <TitleBarWorkspace
                name={workspaceLabel(activeWorkspace)}
                icon={activeWorkspace.icon ?? null}
              />
            ) : null
          }
          right={
            <>
              <PlayButton
                workspaceId={activeWorkspaceId}
                scopeId={activeScope?.id ?? null}
                cwd={activeScope?.directory ?? null}
              />
              <CommitButton directory={activeScope?.directory ?? null} />
              {sidebarViews.length > 0 && (
                <RightSidebarToggle
                  open={isRightBodyOpen}
                  onToggle={onRightToggle}
                />
              )}
            </>
          }
        />
      )}
      </ErrorBoundary>

      <div
        className="flex min-h-0 min-w-0 flex-1 flex-row"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        {workspaceRailOpen && (
          <WorkspaceRail
            workspaces={rail}
            pinnedBottomWorkspaces={pinnedBottomRail}
            // `activeWorkspaceId` is already null while onboarding
            // is the active view (it's derived from `activeView`'s
            // workspace case), so no tile lights up. `addActive`
            // makes the "+" itself light up in that mode.
            activeId={activeWorkspaceId}
            addActive={activeView.kind === "onboarding"}
            onSelect={handleSelectWorkspace}
            onAdd={handleAddWorkspace}
            onContextMenu={(id, e) => {
              void handleWorkspaceContextMenu(id, e)
            }}
            onBackgroundContextMenu={e => {
              void handleRailBackgroundContextMenu(e)
            }}
            footer={
              <UtilityIconButton title="Settings" onClick={onOpenSettings}>
                <SettingsIcon />
              </UtilityIconButton>
            }
          />
        )}
        <div className="relative min-h-0 min-w-0 flex-1">
          <ErrorBoundary label="Workspace">
          {workspaces.length === 0 || activeView.kind === "onboarding" ? (
            <EmptyWorkspaceScreen />
          ) : (
          <Allotment
            ref={outerAllotmentRef}
            // Marks this as the outermost app-shell Allotment. The
            // 12px separator inset in `main.css` is scoped to this
            // class so it only applies here (where the separator
            // actually meets the window's rounded outer corner) and
            // not to nested Allotments — see the comment on
            // `.app-shell-allotment` in main.css.
            className="app-shell-allotment"
            proportionalLayout={false}
            onChange={sizes => {
              // Track the live total so the workspace-switch effect
              // can compute the "other pane" size when it imperatively
              // resizes. The persistence write happens on `onDragEnd`,
              // not here — see the workspace-switch comment for why.
              outerTotalWidthRef.current = sizes.reduce(
                (a, b) => a + b,
                0,
              )
            }}
            onDragEnd={sizes => {
              const [left] = sizes
              if (sidebarOpen && left > 0) {
                setWorkspaceLayout({ sidebarWidth: left })
              }
            }}
            onVisibleChange={(index, visible) => {
              if (index === 0 && !visible) setSidebarOpen(false)
            }}
          >
            <Allotment.Pane
              visible={sidebarOpen}
              minSize={SNAP_SIDEBAR_WIDTH}
              preferredSize={sidebarWidth}
              priority={LayoutPriority.Low}
              snap
            >
              <div className="flex h-full overflow-hidden text-[13px]">
                <ErrorBoundary label="Agent sidebar">
                <Sidebar
                  flushLeft={!workspaceRailOpen}
                  header={
                    <>
                      <LeftSidebarTabBar
                        active={leftSidebarTab}
                        onSelect={setLeftSidebarTab}
                      />
                      {leftSidebarTab === "agent" && (
                        <div className="pb-1 pt-1">
                          <NewChatSplitButton
                            onNewChat={() => {
                              void handleNewChat()
                            }}
                            onCreateWorktree={
                              activeRepo ? handleCreateWorktreeAccordion : undefined
                            }
                            onImportWorktrees={
                              activeRepo ? handleImportWorktrees : undefined
                            }
                            onCreatePlugin={
                              activeWorkspace?.sentinel
                                ? () => setCreatePluginOpen(true)
                                : undefined
                            }
                            newChatShortcut="⌘N"
                          />
                        </div>
                      )}
                    </>
                  }
                  footer={
                    leftSidebarTab === "agent" ? (
                      <AgentSidebarFooter />
                    ) : null
                  }
                >
                  {leftSidebarTab === "pi-sessions" ? (
                    <PiSessionsTreeSidebar
                      onEntrySelect={(sessionId, entryId, label) => {
                        setBranchPrompt({ sessionId, entryId, label })
                      }}
                    />
                  ) : leftSidebarTab === "extra-dirs" ? (
                    <ExtraDirsSidebar />
                  ) : sidebarGroups.length === 0 ? (
                    <div className="px-3 py-6 text-center text-[11px] text-muted-foreground">
                      No chats here yet.
                    </div>
                  ) : sidebarGroups.length === 1 ? (
                    // Single-worktree case: skip the group wrapper
                    // entirely. The grouping affordance only adds
                    // value when there are multiple worktrees to
                    // distinguish; otherwise it's just an extra
                    // collapsible row above a flat chat list.
                    sidebarGroups[0]!.chats.map(chat => (
                      <ChatSidebarItem
                        key={chat.id}
                        chat={chat}
                        session={
                          chat.session.kind === "ready"
                            ? sessionsById[chat.session.sessionId]
                            : undefined
                        }
                        isActive={isChatActiveForSession(
                          chat,
                          activeChatId,
                          chats,
                        )}
                        onSelect={() => handleSelectChat(chat.id)}
                        onContextMenu={e => {
                          void handleChatContextMenu(chat, e)
                        }}
                        onOpenInNewTab={() => {
                          void dbClient.update(root => {
                            openChatInNewTabInRoot(root, windowId, chat.id)
                          })
                        }}
                        onArchive={() => {
                          archiveChat(chat)
                        }}
                        canArchive={sidebarGroups[0]!.chats.length > 1}
                      />
                    ))
                  ) : (
                    sidebarGroups.map(group => {
                      // Persisted per-group collapse state — user's
                      // explicit toggle wins. We deliberately do NOT
                      // force-expand the active group: doing that
                      // makes the trigger feel broken (you click to
                      // collapse, the persisted bit flips, but the
                      // override snaps it open).
                      const collapsed =
                        collapsedGroups[group.scope.id] ?? false
                      const scopeForGroup = group.scope
                      // Surface child streaming activity on the
                      // group header when collapsed so users can
                      // still see that an agent is working inside.
                      // The header itself only renders the spinner
                      // while collapsed; we always compute it so
                      // the prop stays in sync as soon as the user
                      // toggles open/closed.
                      const groupIsStreaming = group.chats.some(
                        chat =>
                          chat.session.kind === "ready" &&
                          (sessionsById[chat.session.sessionId]
                            ?.isStreaming ??
                            false),
                      )
                      // Surface the active chat's selection on the
                      // group header when collapsed, so the user can
                      // still see which worktree contains their
                      // active chat. Same reasoning as
                      // `groupIsStreaming` — the child row isn't
                      // mounted while collapsed, so without this
                      // there's nothing visually indicating "the
                      // active chat lives inside here".
                      const groupHasActiveChat = group.chats.some(
                        chat =>
                          isChatActiveForSession(
                            chat,
                            activeChatId,
                            chats,
                          ),
                      )
                      // Surface unread state the same way: if any
                      // chat in this group has the unread dot AND it
                      // isn't the active chat (the dot is suppressed
                      // on the active row by definition), bubble it
                      // up to the group header while collapsed.
                      const groupHasUnread = group.chats.some(chat => {
                        if (chat.session.kind !== "ready") return false
                        const isActive = isChatActiveForSession(
                          chat,
                          activeChatId,
                          chats,
                        )
                        if (isActive) return false
                        const s = sessionsById[chat.session.sessionId]
                        if (!s) return false
                        return (
                          s.lastCompletedAt != null &&
                          s.lastCompletedAt > (s.lastOpenedAt ?? 0)
                        )
                      })
                      return (
                        <WorktreeGroupRow
                          key={group.scope.id}
                          label={worktreeGroupLabel(
                            scopeForGroup,
                            activeRepo,
                          )}
                          rightIndicator={
                            scopeForGroup.pluginName != null ? (
                              <WorktreeGroupPluginIcon />
                            ) : null
                          }
                          collapsed={collapsed}
                          isStreaming={groupIsStreaming}
                          isActiveChildCollapsed={groupHasActiveChat}
                          hasUnread={groupHasUnread}
                          onToggle={() => {
                            toggleWorktreeGroup(group.scope.id)
                          }}
                          onContextMenu={e => {
                            void handleWorktreeGroupContextMenu(
                              scopeForGroup,
                              e,
                            )
                          }}
                          pinned={scopeForGroup.pinnedAt != null}
                          pinSlot={
                            sidebarGroups.length > 1 ? (
                              <WorktreeGroupPinButton
                                pinned={
                                  scopeForGroup.pinnedAt != null
                                }
                                onToggle={() => {
                                  toggleWorktreeScopePin(
                                    scopeForGroup.id,
                                  )
                                }}
                              />
                            ) : null
                          }
                          hoverActions={
                            <>
                              <ChatRowActionButton
                                title="New chat in this worktree"
                                onClick={() => {
                                  createChatInScope(scopeForGroup.id)
                                }}
                              >
                                <ComposeIcon />
                              </ChatRowActionButton>
                              <ChatRowActionButton
                                title="More"
                                onClick={async e => {
                                  const rect = (
                                    e.currentTarget as HTMLButtonElement
                                  ).getBoundingClientRect()
                                  const { chosenId } =
                                    await rpc.app.contextMenu.show({
                                      x: Math.round(rect.right),
                                      y: Math.round(rect.bottom),
                                      items: [
                                        {
                                          id: "archive",
                                          label: "Archive worktree",
                                          enabled:
                                            sidebarGroups.length > 1,
                                        },
                                        {
                                          id: "complete",
                                          label: "Mark worktree as completed",
                                          enabled:
                                            sidebarGroups.length > 1,
                                        },
                                      ],
                                    })
                                  if (chosenId === "archive") {
                                    archiveWorktreeScope(
                                      scopeForGroup.id,
                                    )
                                  } else if (chosenId === "complete") {
                                    completeWorktreeScope(
                                      scopeForGroup.id,
                                    )
                                  }
                                }}
                              >
                                <MoreIcon />
                              </ChatRowActionButton>
                            </>
                          }
                        >
                          {group.chats.map(chat => (
                            <ChatSidebarItem
                              key={chat.id}
                              chat={chat}
                              session={
                                chat.session.kind === "ready"
                                  ? sessionsById[chat.session.sessionId]
                                  : undefined
                              }
                              isActive={isChatActiveForSession(
                                chat,
                                activeChatId,
                                chats,
                              )}
                              onSelect={() => handleSelectChat(chat.id)}
                              onContextMenu={e => {
                                void handleChatContextMenu(chat, e)
                              }}
                              onOpenInNewTab={() => {
                                void dbClient.update(root => {
                                  openChatInNewTabInRoot(
                                    root,
                                    windowId,
                                    chat.id,
                                  )
                                })
                              }}
                              onArchive={() => {
                                archiveChat(chat)
                              }}
                              canArchive={group.chats.length > 1}
                            />
                          ))}
                        </WorktreeGroupRow>
                      )
                    })
                  )}
                </Sidebar>
                </ErrorBoundary>
              </div>
            </Allotment.Pane>

            <Allotment.Pane priority={LayoutPriority.High}>
              <Allotment
                ref={verticalAllotmentRef}
                vertical
                proportionalLayout={false}
                onChange={sizes => {
                  verticalTotalHeightRef.current = sizes.reduce(
                    (a, b) => a + b,
                    0,
                  )
                }}
                onDragEnd={sizes => {
                  const bottom = sizes[1]
                  if (terminalOpen && bottom != null && bottom > 0) {
                    setWorkspaceLayout({ terminalHeight: bottom })
                  }
                }}
                onVisibleChange={(index, visible) => {
                  if (index === 1 && !visible) setTerminalOpen(false)
                }}
              >
                <Allotment.Pane priority={LayoutPriority.High}>
                  <Allotment
                    ref={innerAllotmentRef}
                    proportionalLayout={false}
                    onChange={sizes => {
                      innerTotalWidthRef.current = sizes.reduce(
                        (a, b) => a + b,
                        0,
                      )
                    }}
                    onDragEnd={sizes => {
                      const right = sizes[1]
                      if (isRightBodyOpen && right != null && right > 0) {
                        setWorkspaceLayout({ rightSidebarWidth: right })
                      }
                    }}
                    onVisibleChange={(index, visible) => {
                      if (index === 1 && !visible) setRightOpenType(null)
                    }}
                  >
                    <Allotment.Pane priority={LayoutPriority.High}>
                      <ChatsHost
                        leftAdjacent={sidebarOpen}
                        bottomAdjacent={terminalOpen}
                        rightAdjacent={isRightBodyOpen}
                      />
                    </Allotment.Pane>

                    {isRightBodyOpen && rightOpenType != null && (
                      <Allotment.Pane
                        key="right-body"
                        minSize={SNAP_RIGHT_SIDEBAR_WIDTH}
                        preferredSize={rightSidebarWidth}
                        priority={LayoutPriority.Low}
                        snap
                      >
                        <ErrorBoundary label="Right sidebar">
                        <RightSidebarBody
                          views={sidebarViews}
                          openType={rightOpenType}
                          onSelectType={onRightSelectType}
                          args={{
                            windowId,
                            scopeId: activeScope?.id ?? null,
                            directory: activeScope?.directory ?? null,
                          }}
                        />
                        </ErrorBoundary>
                      </Allotment.Pane>
                    )}
                  </Allotment>
                </Allotment.Pane>

                {/* Always mount the terminal pane and toggle via
                    Allotment's own `visible` prop. Conditionally
                    *unmounting* the pane (`{terminalOpen && ...}`)
                    races with Allotment's first measurement pass:
                    on the frame the pane appears it reads as 0px,
                    Allotment fires `onVisibleChange(1, false)`, and
                    our handler immediately flips `terminalOpen` back
                    off — producing the "opens for one frame then
                    snaps shut" symptom. Using `visible` keeps the
                    pane in Allotment's children from the start so
                    measurement is stable. */}
                <Allotment.Pane
                  key="bottom-panel"
                  visible={terminalOpen && activeBottomPanelView != null}
                  minSize={SNAP_TERMINAL_HEIGHT}
                  preferredSize={terminalHeight}
                  priority={LayoutPriority.Low}
                  snap
                >
                  {activeBottomPanelView != null && (
                    <ErrorBoundary label="Bottom panel">
                      <BottomPanelBody
                        views={bottomPanelViews}
                        openType={activeBottomPanelView}
                        onSelectType={setBottomPanelView}
                        panelOpen={terminalOpen}
                        args={{
                          windowId,
                          scopeId: activeScope?.id ?? null,
                          directory: activeScope?.directory ?? null,
                        }}
                      />
                    </ErrorBoundary>
                  )}
                </Allotment.Pane>
              </Allotment>
            </Allotment.Pane>
          </Allotment>
          )}
          </ErrorBoundary>
        </div>

      </div>

      <CreateWorktreeDialog
        open={createWorktreeOpen}
        onOpenChange={setCreateWorktreeOpen}
        repoId={activeRepoId}
        mainWorktreePath={activeRepo?.mainWorktreePath ?? null}
        defaultSourceRef={createWorktreeSourceRef}
        onCreated={({ worktreePath, branch }) => {
          // Materialize a scope for the new worktree directory +
          // a fresh pending chat in it, then focus the chat. This
          // is what makes the new worktree show up in the
          // sidebar (the heuristic: worktrees only render as
          // groups when they have at least one chat).
          console.log("[create-worktree] onCreated", {
            worktreePath,
            branch,
            activeWorkspaceId,
            activeRepoId,
          })
          if (!activeWorkspaceId) {
            console.warn(
              "[create-worktree] no active workspace; skipping scope/chat creation",
            )
            return
          }
          const newScopeId = nanoid()
          const chatId = nanoid()
          const now = Date.now()
          const workspaceId = activeWorkspaceId
          const repoId = activeRepoId
          let finalScopeId = newScopeId
          void dbClient
            .update(root => {
              // Defensive: if some other path already materialized
              // the scope for this worktree (e.g. via Import
              // Worktrees), reuse it instead of duplicating.
              const existing = Object.values(root.app.scopes).find(
                s =>
                  s.workspaceId === workspaceId &&
                  s.directory === worktreePath,
              )
              finalScopeId = existing?.id ?? newScopeId
              if (!existing) {
                // "New worktree" from the split-button creates a
                // secondary worktree off of an existing branch —
                // never the main one — so it starts unpinned and
                // sorts above older scopes by createdAt.
                root.app.scopes[finalScopeId] = {
                  id: finalScopeId,
                  workspaceId,
                  directory: worktreePath,
                  repoId,
                  extraDirectories: [],
                  createdAt: now,
                  archived: false,
                  completed: false,
                  archivedAt: null,
                  completedAt: null,
                  pinnedAt: null,
                  unpinnedAt: null,
                }
              } else {
                // Reusing a soft-hidden scope: un-archive /
                // un-complete it so the group reappears in the
                // sidebar. Mirrors `useImportWorktrees`.
                if (existing.archived) {
                  existing.archived = false
                  existing.archivedAt = null
                }
                if (existing.completed) {
                  existing.completed = false
                  existing.completedAt = null
                }
              }
              root.app.chats[chatId] = {
                id: chatId,
                scopeId: finalScopeId,
                session: { kind: "pending" },
                createdAt: now,
              }
              selectChatInRoot(root, windowId, chatId)
            })
            .then(() => {
              console.log("[create-worktree] materialized", {
                finalScopeId,
                chatId,
              })
              void rpc.app.sessions
                .createChatSession({ scopeId: finalScopeId, chatId })
                .catch(err =>
                  console.error(
                    "[create-worktree] createChatSession failed:",
                    err,
                  ),
                )
              requestFocusComposer(chatId)
            })
        }}
      />
      <CreatePluginDialog
        open={createPluginOpen}
        onOpenChange={setCreatePluginOpen}
        onCreated={({ chatId }) => {
          // The service already materialized the scope + chat in the
          // db replica. Just select the new chat in the active pane
          // and nudge the composer to refocus, mirroring the create-
          // worktree path.
          void dbClient
            .update(root => {
              selectChatInRoot(root, windowId, chatId)
            })
            .then(() => {
              requestFocusComposer(chatId)
            })
        }}
      />
      <BranchSummaryDialog
        open={branchPrompt !== null}
        targetLabel={branchPrompt?.label ?? null}
        busy={branchPromptBusy}
        onConfirm={handleBranchPromptConfirm}
        onCancel={handleBranchPromptCancel}
      />
    </div>
  )
}

function workspaceLabel(workspace: Workspace): string {
  return workspace.name
}

function directoryBasename(dir: string): string {
  const parts = dir.split("/").filter(Boolean)
  return parts[parts.length - 1] ?? dir
}

/**
 * Label for a worktree-group header row. Prefers the worktree's
 * branch name when we have repo metadata for it (branches read more
 * naturally than directory basenames), falling back to the
 * directory basename when the scope isn't backed by a git worktree
 * or repo info hasn't been synced yet.
 */
function worktreeGroupLabel(
  scope: Scope,
  repo: Repo | null,
): string {
  if (repo) {
    const wt = repo.worktrees.find(w => w.path === scope.directory)
    if (wt?.branch) return wt.branch
  }
  return directoryBasename(scope.directory)
}

/**
 * Resolve the label to display for a chat row.
 *
 * Precedence: AI summary (read directly from the db replica) →
 * `session.branchSummary` → `session.title` → "New Chat". The summary
 * is written to `root.app.sessionMeta[sessionId].summary` on every
 * prompt by `SummariesService.record`.
 */
function resolveChatLabel(
  chat: Chat,
  session: Session | undefined,
  aiSummary: string | null,
): { label: string } {
  if (chat.session.kind !== "ready") {
    return { label: "New Chat" }
  }

  if (aiSummary && aiSummary.trim()) {
    return { label: truncateInline(aiSummary.trim(), 60) }
  }

  const branchSummary = session?.branchSummary
  if (branchSummary && branchSummary.trim()) {
    return { label: truncateInline(branchSummary.trim(), 60) }
  }

  const title = session?.title?.trim()
  if (title && title !== "Untitled") {
    return { label: title }
  }

  return { label: "New Chat" }
}

/**
 * Sync version of label resolution — callers that don't already have
 * the AI summary handy fall through to branchSummary / title without
 * subscribing to the db key.
 */
function chatLabel(
  chat: Chat,
  sessionsById: Record<
    string,
    { title?: string; branchSummary?: string | null } | undefined
  >,
): string {
  if (chat.session.kind !== "ready") return "New Chat"
  const session = sessionsById[chat.session.sessionId]
  const summary = session?.branchSummary
  if (summary && summary.trim()) {
    return truncateInline(summary.trim(), 60)
  }
  const title = session?.title?.trim()
  if (title && title !== "Untitled") return title
  return "New Chat"
}

interface ChatSidebarItemProps {
  chat: Chat
  session: Session | undefined
  isActive: boolean
  onSelect: () => void
  onContextMenu: (e: React.MouseEvent) => void
  onOpenInNewTab: () => void
  onArchive: () => void
  /** When false the hover Archive button is hidden. Used when this
   * chat is the *only* one in its worktree group — archiving it
   * would silently empty the group and make the worktree vanish
   * from the sidebar, which has no visible affordance for the
   * user to predict, so we hide the action entirely. */
  canArchive: boolean
}

function ChatSidebarItem({
  chat,
  session,
  isActive,
  onSelect,
  onContextMenu,
  onOpenInNewTab,
  onArchive,
  canArchive,
}: ChatSidebarItemProps) {
  const sessionId =
    chat.session.kind === "ready" ? chat.session.sessionId : null
  const summary = useSummary(sessionId)
  const { label } = resolveChatLabel(chat, session, summary)
  // Subscribe per-row to *just this chat's* draft. We deliberately
  // don't pull the whole `chatStates` map into the parent and pass
  // a `hasDraft` flag down — doing it here means typing in one chat
  // only re-renders that chat's sidebar item, not every row.
  // Empty / whitespace-only drafts don't count (the composer
  // collapses to an empty editor for them, so flagging the row
  // would be misleading).
  const draftText = useDb(
    root => root.app.chatStates[chat.id]?.draft ?? "",
  )
  const hasDraft = !isActive && draftText.trim().length > 0
  // Unread = agent completed a turn since the user last opened the
  // chat. The dot is suppressed on the active row because the user
  // is by definition "on it" (and `SessionActivityService` is
  // about to bump `lastOpenedAt` on the next recompute).
  const hasUnread =
    !isActive &&
    session != null &&
    session.lastCompletedAt != null &&
    session.lastCompletedAt > (session.lastOpenedAt ?? 0)

  return (
    <ChatTreeRow
      label={label}
      isGeneratingTitle={false}
      isActive={isActive}
      isStreaming={session?.isStreaming ?? false}
      hasUnread={hasUnread}
      hasDraft={hasDraft}
      timestamp={session?.lastActivityAt ?? chat.createdAt}
      expandable={false}
      isExpanded={false}
      onToggleExpand={NOOP}
      onClick={onSelect}
      onContextMenu={onContextMenu}
      hoverActions={
        <>
          <ChatRowActionButton
            title="Open in new tab"
            onClick={onOpenInNewTab}
          >
            <NewTabIcon />
          </ChatRowActionButton>
          {canArchive && (
            <ChatRowActionButton title="Archive" onClick={onArchive}>
              <ArchiveIcon />
            </ChatRowActionButton>
          )}
          <ChatRowActionButton
            title="More"
            onClick={e => {
              const rect = (
                e.currentTarget as HTMLButtonElement
              ).getBoundingClientRect()
              onContextMenu({
                clientX: rect.right,
                clientY: rect.bottom,
                preventDefault: () => {},
                stopPropagation: () => {},
              } as unknown as React.MouseEvent)
            }}
          >
            <MoreIcon />
          </ChatRowActionButton>
        </>
      }
      treeContent={null}
    />
  )
}

const NOOP = () => {}

function truncateInline(s: string, n: number): string {
  const oneLine = s.replace(/\s+/g, " ")
  if (oneLine.length <= n) return oneLine
  return oneLine.slice(0, n - 1) + "…"
}

function scopeForChat(
  scopeId: string,
  scopes: Scope[],
): Scope | undefined {
  return scopes.find(s => s.id === scopeId)
}

/**
 * A sidebar row is "active" when the chat currently focused in the
 * active pane belongs to the same session as the row's representative
 * chat. That way ⌘/ splits don't visually split the row — the one
 * row stays lit while the user toggles between panes that share the
 * session.
 */
function isChatActiveForSession(
  row: Chat,
  activeChatId: string | null,
  allChats: Chat[],
): boolean {
  if (!activeChatId) return false
  if (row.id === activeChatId) return true
  if (row.session.kind !== "ready") return false
  const active = allChats.find(c => c.id === activeChatId)
  if (!active || active.session.kind !== "ready") return false
  return active.session.sessionId === row.session.sessionId
}

/**
 * Pin / unpin button for the right edge of a worktree-group row.
 * Always mounted in the same x position and always visible (when
 * the parent decides multi-worktree mode is on) so toggling
 * pinned state doesn't shift the row layout and the user can see
 * the affordance without hovering.
 *
 * Pinned   → filled glyph at full opacity ("this is the anchor").
 * Unpinned → outlined glyph at low opacity, brightens on direct
 *             hover or whenever the row is hovered (matches the
 *             feel of the compose / more actions sliding in).
 */
function WorktreeGroupPinButton({
  pinned,
  onToggle,
}: {
  pinned: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      aria-label={pinned ? "Unpin worktree" : "Pin worktree"}
      title={pinned ? "Unpin worktree" : "Pin worktree"}
      aria-pressed={pinned}
      onClick={e => {
        e.stopPropagation()
        onToggle()
      }}
      onMouseDown={e => e.stopPropagation()}
      className={cn(
        "flex h-[20px] w-[20px] items-center justify-center rounded text-muted-foreground transition-opacity hover:bg-foreground/10 hover:text-foreground",
        pinned
          ? // Pinned anchor: always visible, full opacity. Acts
            // as both "this is the anchor" indicator and the
            // click target to unpin.
            "opacity-100"
          : // Unpinned: hidden at rest so the row reads clean.
            // Fades in on row hover (alongside compose / more)
            // so the user can discover the pin affordance.
            // `pointer-events-none` while hidden so the
            // invisible button doesn't intercept row clicks.
            "opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto",
      )}
    >
      <PinIcon filled={pinned} />
    </button>
  )
}

function ChatRowActionButton({
  title,
  onClick,
  children,
}: {
  title: string
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={title}
      onClick={e => {
        e.stopPropagation()
        onClick(e)
      }}
      onMouseDown={e => e.stopPropagation()}
      className="flex h-[20px] w-[20px] items-center justify-center rounded text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
    >
      {children}
    </button>
  )
}

function ArchiveIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ pointerEvents: "none" }}
    >
      <rect width="20" height="5" x="2" y="3" rx="1" />
      <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
      <path d="M10 12h4" />
    </svg>
  )
}

function NewTabIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* "Open in new tab": a window/tab frame with an arrow
          pointing up-and-out of its top-right corner, the same
          convention browsers use for external/new-tab links. */}
      <path d="M14 4h6v6" />
      <path d="M20 4l-8 8" />
      <path d="M19 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h6" />
    </svg>
  )
}

function MoreIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="currentColor"
    >
      <circle cx="5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="19" cy="12" r="1.6" />
    </svg>
  )
}

function PinIcon({ filled }: { filled: boolean }) {
  // Lucide-style thumbtack glyph: a tilted pin with the tack head
  // top-right and the point bottom-left. When `filled` we keep the
  // outlined stroke but flood the head/shaft so the pinned state
  // reads as "sticky / locked in place" at a glance.
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ pointerEvents: "none" }}
    >
      <path d="M12 17v5" />
      <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
    </svg>
  )
}

function ComposeIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  )
}

/**
 * Right-edge puzzle indicator rendered next to plugin-development
 * worktree groups (scopes with `pluginName != null`). Lives in
 * `WorktreeGroupRow`'s `rightIndicator` slot so the row's own
 * hover-out transition handles visibility — we just need the
 * glyph. Wrapping in `<title>` gives a free native tooltip
 * without pulling in our popover stack for a passive indicator.
 */
function WorktreeGroupPluginIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-label="Plugin worktree"
    >
      <title>Plugin worktree</title>
      {/* Lucide `Puzzle` icon path — kept inline (rather than
          pulling in the React component) so this glyph stays
          consistent with the other hand-rolled svgs in this file,
          which all share the same 24x24 viewBox + stroke setup. */}
      <path d="M15.39 4.39a1 1 0 0 0 1.68-.474 2.5 2.5 0 1 1 3.014 3.015 1 1 0 0 0-.474 1.68l1.683 1.682a2.414 2.414 0 0 1 0 3.414L19.61 15.39a1 1 0 0 1-1.68-.474 2.5 2.5 0 1 0-3.014 3.015 1 1 0 0 1 .474 1.68l-1.683 1.682a2.414 2.414 0 0 1-3.414 0L8.61 19.61a1 1 0 0 0-1.68.474 2.5 2.5 0 1 1-3.014-3.015 1 1 0 0 0 .474-1.68l-1.683-1.682a2.414 2.414 0 0 1 0-3.414L4.39 8.61a1 1 0 0 1 1.68.474 2.5 2.5 0 1 0 3.014-3.015 1 1 0 0 1-.474-1.68l1.683-1.682a2.414 2.414 0 0 1 3.414 0z" />
    </svg>
  )
}

function SettingsIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  )
}
