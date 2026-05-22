import { useCallback } from "react"
import { useDb, useDbClient, useRpc } from "@zenbujs/core/react"
import { nanoid } from "nanoid"

const DEFAULT_WINDOW_ID = "main"

/**
 * The windowId for the current renderer. `WindowService.openView` always
 * stamps `?windowId=<id>` into the iframe/window URL, so we read it from
 * the query string. Falls back to `"main"` for legacy callers that
 * mount this hook outside of a normal view URL (e.g. tests).
 */
function readWindowIdFromUrl(): string {
  if (typeof window === "undefined") return DEFAULT_WINDOW_ID
  const fromUrl = new URLSearchParams(window.location.search).get("windowId")
  return fromUrl && fromUrl.length > 0 ? fromUrl : DEFAULT_WINDOW_ID
}

const CURRENT_WINDOW_ID = readWindowIdFromUrl()

export function useWindowId(): string {
  return CURRENT_WINDOW_ID
}

export function useWindowState() {
  const windowId = useWindowId()
  return useDb(root => root.app.windowStates[windowId])
}

/* ============================================================ *
 * Active selection hooks
 *
 * Workspace is the primary axis. Everything else is derived:
 *   - active chat = `workspacePanes[selectedWorkspaceId]`'s active
 *     pane's active tab.
 *   - active scope = `chats[activeChatId]?.scopeId`, cached in
 *     `selectedScopeId` so iframe views walking window-state can
 *     read it in O(1).
 * ============================================================ */

export function useActiveWorkspaceId(): string | null {
  const windowId = useWindowId()
  return useDb(
    root => root.app.windowStates[windowId]?.selectedWorkspaceId ?? null,
  )
}

export function useActiveScopeId(): string | null {
  const windowId = useWindowId()
  return useDb(
    root => root.app.windowStates[windowId]?.selectedScopeId ?? null,
  )
}

/** Extract the chatId from a tab, regardless of content kind. */
function chatIdOf(
  tab: { content: { kind: string; chatId?: string | null } } | null | undefined,
): string | null {
  if (!tab) return null
  return tab.content.kind === "chat" ? tab.content.chatId ?? null : null
}

/* --------------------------- per-tab history ---------------------------- */

type PaneTabContentLike =
  | { kind: "chat"; chatId: string | null }
  | { kind: "view"; viewType: string; args: Record<string, unknown> }

type PaneTabLike = {
  id: string
  content: PaneTabContentLike
  history: {
    entries: PaneTabContentLike[]
    index: number
  }
}

/** Deep-clone a tab content payload so a value pulled out of one
 * `history.entries` slot doesn't alias the same proxy when written
 * back into `tab.content`. The replica's reactive proxies can
 * otherwise produce surprising aliasing where mutating one path
 * also mutates a sibling. */
function cloneContent(content: PaneTabContentLike): PaneTabContentLike {
  if (content.kind === "chat") {
    return { kind: "chat", chatId: content.chatId }
  }
  return {
    kind: "view",
    viewType: content.viewType,
    args: { ...content.args },
  }
}

/** Build a fresh tab object with a one-entry history. Use this at
 * every tab-creation site so the invariant
 * `history.entries[history.index] === content` always holds. */
function makeTab(id: string, content: PaneTabContentLike): PaneTabLike {
  return {
    id,
    content,
    history: { entries: [cloneContent(content)], index: 0 },
  }
}

/** Return a *new* tab with `nextContent` pushed onto the history
 * stack. Mirrors the browser navigation model: any forward history
 * past the current cursor is dropped, then the new view is appended
 * and the cursor moves to it. */
function pushTabContent(
  tab: PaneTabLike,
  nextContent: PaneTabContentLike,
): PaneTabLike {
  const history = tab.history ?? { entries: [], index: -1 }
  const idx = typeof history.index === "number" ? history.index : -1
  const past = (history.entries ?? []).slice(0, idx + 1)
  const nextEntries = [...past, cloneContent(nextContent)]
  return {
    id: tab.id,
    content: nextContent,
    history: { entries: nextEntries, index: nextEntries.length - 1 },
  }
}

/* ============================================================ *
 * Active chat resolution
 * ============================================================ */

export function useActiveChatId(): string | null {
  const windowId = useWindowId()
  return useDb(root => {
    const ws = root.app.windowStates[windowId]
    if (!ws) return null
    const workspaceId = ws.selectedWorkspaceId
    if (!workspaceId) return null
    const paneState = ws.workspacePanes?.[workspaceId]
    if (paneState) {
      const pane = paneState.panes.find(p => p.id === paneState.activePaneId)
        ?? paneState.panes[0]
      const tab = pane?.tabs.find(t => t.id === pane.activeTabId) ?? pane?.tabs[0]
      const chatId = chatIdOf(tab)
      if (chatId) return chatId
    }
    return latestChatIdInWorkspace(root, workspaceId)
  })
}

function latestChatIdInWorkspace(root: Root, workspaceId: string): string | null {
  // Walk scopes in the workspace, then chats in those scopes, picking
  // the newest by createdAt. Single pass; not hot enough to index.
  const workspaceScopes = new Set<string>()
  for (const scope of Object.values(root.app.scopes)) {
    if (scope.workspaceId === workspaceId) workspaceScopes.add(scope.id)
  }
  let latestId: string | null = null
  let latestAt = -Infinity
  for (const chat of Object.values(root.app.chats)) {
    if (!workspaceScopes.has(chat.scopeId)) continue
    if (chat.createdAt > latestAt) {
      latestAt = chat.createdAt
      latestId = chat.id
    }
  }
  return latestId
}

/** The workspace's "primary" scope — earliest-created scope in that
 * workspace, used as a fallback target for new chats when there's no
 * active chat to inherit a scope from. */
function workspacePrimaryScopeId(
  root: Root,
  workspaceId: string,
): string | null {
  let earliest: { id: string; createdAt: number } | null = null
  for (const scope of Object.values(root.app.scopes)) {
    if (scope.workspaceId !== workspaceId) continue
    if (!earliest || scope.createdAt < earliest.createdAt) {
      earliest = { id: scope.id, createdAt: scope.createdAt }
    }
  }
  return earliest?.id ?? null
}

export function useActiveTerminalId(): string | null {
  const windowId = useWindowId()
  return useDb(root => {
    const ws = root.app.windowStates[windowId]
    if (!ws) return null
    const scopeId = ws.selectedScopeId
    if (!scopeId) return null
    const id = ws.scopeLastTerminal?.[scopeId]
    if (!id) return null
    return root.app.terminals[id] ? id : null
  })
}

type DbClient = ReturnType<typeof useDbClient>
type UpdateFn = Parameters<DbClient["update"]>[0]
type Root = Parameters<UpdateFn>[0]

function ensureWindowState(root: Root, windowId: string) {
  const existing = root.app.windowStates[windowId]
  if (existing) {
    if (!existing.scopeLastTerminal) existing.scopeLastTerminal = {}
    if (!existing.workspacePanes) existing.workspacePanes = {}
    if (!existing.worktreeGroupCollapsed) existing.worktreeGroupCollapsed = {}
    return existing
  }
  root.app.windowStates[windowId] = {
    selectedWorkspaceId: null,
    selectedScopeId: null,
    scopeLastTerminal: {},
    worktreeGroupCollapsed: {},
    leftSidebarTab: "agent",
    workspacePanes: {},
    bottomPanelView: null,
    leftSidebarOpen: true,
    workspaceRailOpen: true,
    rightSidebarOpenType: null,
    rightSidebarLastType: null,
    bottomPanelOpen: false,
  }
  return root.app.windowStates[windowId]!
}

/**
 * Pane state for a workspace. Created lazily with a single pane + a
 * single tab. The tab points at the workspace's most recent chat
 * (which always exists since we never let a workspace go empty); if
 * for some reason no chat exists yet, the tab is a chat tab with
 * `chatId=null` and `ChatPaneContainer`'s auto-materialize effect
 * fills it in on first paint.
 */
function ensureWorkspacePanes(
  root: Root,
  windowId: string,
  workspaceId: string,
): NonNullable<NonNullable<Root["app"]["windowStates"][string]>["workspacePanes"]>[string] {
  const ws = ensureWindowState(root, windowId)
  let state = ws.workspacePanes[workspaceId]
  if (!state) {
    const seedChatId = latestChatIdInWorkspace(root, workspaceId)
    const paneId = nanoid()
    const tabId = nanoid()
    state = {
      panes: [
        {
          id: paneId,
          tabs: [makeTab(tabId, { kind: "chat", chatId: seedChatId })],
          activeTabId: tabId,
        },
      ],
      activePaneId: paneId,
    }
    ws.workspacePanes[workspaceId] = state
  }
  return state
}

function getActivePane(
  state: ReturnType<typeof ensureWorkspacePanes>,
) {
  return (
    state.panes.find(p => p.id === state.activePaneId) ?? state.panes[0]!
  )
}

/**
 * After any mutation that changes which tab is active, recompute
 * `selectedScopeId` from the new active tab's chat. Keeps the iframe-
 * visible cache in sync with the workspace-scoped pane state.
 */
function refreshSelectedScope(
  root: Root,
  windowId: string,
  workspaceId: string,
): void {
  const ws = root.app.windowStates[windowId]
  if (!ws) return
  const state = ws.workspacePanes?.[workspaceId]
  if (!state) return
  const pane = state.panes.find(p => p.id === state.activePaneId) ?? state.panes[0]
  const tab = pane?.tabs.find(t => t.id === pane.activeTabId) ?? pane?.tabs[0]
  const chatId = chatIdOf(tab)
  if (chatId) {
    const chat = root.app.chats[chatId]
    if (chat) {
      ws.selectedScopeId = chat.scopeId
      return
    }
  }
  // No usable active chat — fall back to the workspace's primary
  // scope so consumers (commit button, sidebar args, etc.) still
  // have a meaningful directory to operate against.
  ws.selectedScopeId = workspacePrimaryScopeId(root, workspaceId)
}

/** Mutate the windowState to focus a terminal within its scope. */
export function selectTerminalInRoot(
  root: Root,
  windowId: string,
  terminalId: string,
): void {
  const terminal = root.app.terminals[terminalId]
  if (!terminal) return
  const ws = ensureWindowState(root, windowId)
  ws.scopeLastTerminal[terminal.scopeId] = terminalId
}

/**
 * Switch to a workspace. Ensures workspace pane state exists, then
 * derives `selectedScopeId` from the active tab in the workspace's
 * panes (or the workspace's primary scope).
 */
export function selectWorkspaceInRoot(
  root: Root,
  windowId: string,
  workspaceId: string,
): void {
  const ws = ensureWindowState(root, windowId)
  ws.selectedWorkspaceId = workspaceId
  ensureWorkspacePanes(root, windowId, workspaceId)
  refreshSelectedScope(root, windowId, workspaceId)
}

/**
 * Focus a chat. Switches workspace if the chat lives in another
 * workspace, then:
 *   1. If the workspace's panes already have a tab showing this
 *      chat, focus that tab.
 *   2. Otherwise replace the active tab's content with the chat.
 * In both cases `selectedScopeId` ends up equal to `chat.scopeId`.
 */
export function selectChatInRoot(
  root: Root,
  windowId: string,
  chatId: string,
): void {
  const chat = root.app.chats[chatId]
  if (!chat) return
  const scope = root.app.scopes[chat.scopeId]
  if (!scope) return
  const ws = ensureWindowState(root, windowId)
  ws.selectedWorkspaceId = scope.workspaceId
  const state = ensureWorkspacePanes(root, windowId, scope.workspaceId)

  // 1. Tab already exists?
  for (const pane of state.panes) {
    const tab = pane.tabs.find(t => chatIdOf(t) === chatId)
    if (!tab) continue
    state.activePaneId = pane.id
    pane.activeTabId = tab.id
    ws.selectedScopeId = chat.scopeId
    return
  }

  // 2. Otherwise replace the active tab.
  const pane = getActivePane(state)
  const tabIdx = pane.tabs.findIndex(t => t.id === pane.activeTabId)
  const idx = tabIdx >= 0 ? tabIdx : 0
  const tab = pane.tabs[idx]!
  const nextTabs = pane.tabs.slice()
  nextTabs[idx] = pushTabContent(tab, { kind: "chat", chatId })
  const paneIdx = state.panes.findIndex(p => p.id === pane.id)
  if (paneIdx >= 0) {
    state.panes[paneIdx] = { ...pane, tabs: nextTabs, activeTabId: tab.id }
  }
  ws.selectedScopeId = chat.scopeId
}

/* --------------------------------- panes -------------------------------- */

/**
 * Search the active workspace's panes for one already showing
 * `chatId`. Returns `true` and focuses it if found. Used by the
 * sidebar's chat click — sidebar always prefers focus over replace
 * when the chat is already a tab somewhere.
 *
 * Switches workspace if the chat lives in a different one.
 */
export function focusPaneShowingChatInRoot(
  root: Root,
  windowId: string,
  chatId: string,
): boolean {
  const chat = root.app.chats[chatId]
  if (!chat) return false
  const scope = root.app.scopes[chat.scopeId]
  if (!scope) return false
  const ws = ensureWindowState(root, windowId)
  if (ws.selectedWorkspaceId !== scope.workspaceId) {
    ws.selectedWorkspaceId = scope.workspaceId
  }
  const state = ws.workspacePanes?.[scope.workspaceId]
  if (!state) return false
  for (const pane of state.panes) {
    const tab = pane.tabs.find(t => chatIdOf(t) === chatId)
    if (!tab) continue
    state.activePaneId = pane.id
    pane.activeTabId = tab.id
    ws.selectedScopeId = chat.scopeId
    return true
  }
  return false
}

export function selectPaneInRoot(
  root: Root,
  windowId: string,
  workspaceId: string,
  paneId: string,
): void {
  const state = ensureWorkspacePanes(root, windowId, workspaceId)
  if (!state.panes.some(p => p.id === paneId)) return
  state.activePaneId = paneId
  refreshSelectedScope(root, windowId, workspaceId)
}

export function selectTabInRoot(
  root: Root,
  windowId: string,
  workspaceId: string,
  paneId: string,
  tabId: string,
): void {
  const state = ensureWorkspacePanes(root, windowId, workspaceId)
  const pane = state.panes.find(p => p.id === paneId)
  if (!pane) return
  if (!pane.tabs.some(t => t.id === tabId)) return
  pane.activeTabId = tabId
  state.activePaneId = paneId
  refreshSelectedScope(root, windowId, workspaceId)
}

/**
 * Resolve the scope a freshly created chat should live in. Prefers
 * the currently active chat's scope, falling back to the workspace's
 * primary (earliest-created) scope.
 */
function resolveNewChatScope(
  root: Root,
  windowId: string,
  workspaceId: string,
): string | null {
  const ws = root.app.windowStates[windowId]
  const state = ws?.workspacePanes?.[workspaceId]
  if (state) {
    const pane = state.panes.find(p => p.id === state.activePaneId) ?? state.panes[0]
    const tab = pane?.tabs.find(t => t.id === pane.activeTabId) ?? pane?.tabs[0]
    const chatId = chatIdOf(tab)
    if (chatId) {
      const chat = root.app.chats[chatId]
      if (chat) return chat.scopeId
    }
  }
  return workspacePrimaryScopeId(root, workspaceId)
}

/**
 * Adds a new tab to a pane, creating a fresh chat (with a pending
 * session) bound to it. The new chat lives in the active chat's
 * scope (or the workspace's primary scope as a fallback). Callers
 * should follow up with `rpc.app.sessions.createChatSession` —
 * `useAddTab` does this automatically.
 */
export function addTabInRoot(
  root: Root,
  windowId: string,
  workspaceId: string,
  paneId: string,
): { tabId: string; chatId: string; scopeId: string } | null {
  const scopeId = resolveNewChatScope(root, windowId, workspaceId)
  if (!scopeId) return null
  const state = ensureWorkspacePanes(root, windowId, workspaceId)
  const paneIdx = state.panes.findIndex(p => p.id === paneId)
  if (paneIdx < 0) return null
  const tabId = nanoid()
  const chatId = nanoid()
  const now = Date.now()
  root.app.chats[chatId] = {
    id: chatId,
    scopeId,
    session: { kind: "pending" },
    createdAt: now,
  }
  const pane = state.panes[paneIdx]!
  const activeIdx = pane.tabs.findIndex(t => t.id === pane.activeTabId)
  const insertAt = activeIdx < 0 ? pane.tabs.length : activeIdx + 1
  const nextTabs = [
    ...pane.tabs.slice(0, insertAt),
    makeTab(tabId, { kind: "chat", chatId }),
    ...pane.tabs.slice(insertAt),
  ]
  state.panes[paneIdx] = {
    ...pane,
    tabs: nextTabs,
    activeTabId: tabId,
  }
  state.activePaneId = paneId
  refreshSelectedScope(root, windowId, workspaceId)
  return { tabId, chatId, scopeId }
}

/**
 * Closes a tab. If it's the last tab in the pane, the whole pane is
 * removed (unless it's the only pane left — see the bottom of the
 * function for the "never leave the workspace empty" rule).
 */
export function closeTabInRoot(
  root: Root,
  windowId: string,
  workspaceId: string,
  paneId: string,
  tabId: string,
): { chatId: string; scopeId: string } | null {
  const state = ensureWorkspacePanes(root, windowId, workspaceId)
  const paneIdx = state.panes.findIndex(p => p.id === paneId)
  if (paneIdx < 0) return null
  const pane = state.panes[paneIdx]!
  if (pane.tabs.length > 1) {
    const removedIdx = pane.tabs.findIndex(t => t.id === tabId)
    if (removedIdx < 0) return null
    const nextTabs = pane.tabs.filter((_, i) => i !== removedIdx)
    let nextActive = pane.activeTabId
    if (pane.activeTabId === tabId) {
      const next = nextTabs[Math.min(removedIdx, nextTabs.length - 1)]!
      nextActive = next.id
    }
    state.panes[paneIdx] = { ...pane, tabs: nextTabs, activeTabId: nextActive }
    refreshSelectedScope(root, windowId, workspaceId)
    return null
  }
  // last tab in pane
  if (state.panes.length > 1) {
    const nextPanes = state.panes.filter((_, i) => i !== paneIdx)
    state.panes = nextPanes
    if (state.activePaneId === paneId) {
      const next = nextPanes[Math.min(paneIdx, nextPanes.length - 1)]!
      state.activePaneId = next.id
    }
    refreshSelectedScope(root, windowId, workspaceId)
    return null
  }
  // last pane in workspace — don't delete it. Replace with a fresh
  // chat-bound tab in a sensible scope so the user never sees an
  // empty placeholder.
  const scopeId = resolveNewChatScope(root, windowId, workspaceId)
  if (!scopeId) return null
  const newTabId = nanoid()
  const newChatId = nanoid()
  const now = Date.now()
  root.app.chats[newChatId] = {
    id: newChatId,
    scopeId,
    session: { kind: "pending" },
    createdAt: now,
  }
  state.panes[paneIdx] = {
    ...pane,
    tabs: [makeTab(newTabId, { kind: "chat", chatId: newChatId })],
    activeTabId: newTabId,
  }
  refreshSelectedScope(root, windowId, workspaceId)
  return { chatId: newChatId, scopeId }
}

/**
 * Splits the workspace by adding a new pane. The new pane starts with
 * a single tab bound to a freshly-created chat (with a pending
 * session) in the active scope, and immediately becomes active.
 */
export function addPaneInRoot(
  root: Root,
  windowId: string,
  workspaceId: string,
  afterPaneId?: string,
): { paneId: string; chatId: string; scopeId: string } | null {
  const scopeId = resolveNewChatScope(root, windowId, workspaceId)
  if (!scopeId) return null
  const state = ensureWorkspacePanes(root, windowId, workspaceId)
  const paneId = nanoid()
  const tabId = nanoid()
  const chatId = nanoid()
  const now = Date.now()
  root.app.chats[chatId] = {
    id: chatId,
    scopeId,
    session: { kind: "pending" },
    createdAt: now,
  }
  const newPane = {
    id: paneId,
    tabs: [makeTab(tabId, { kind: "chat", chatId })],
    activeTabId: tabId,
  }
  const insertAfter =
    afterPaneId != null ? state.panes.findIndex(p => p.id === afterPaneId) : -1
  const next = state.panes.slice()
  if (insertAfter >= 0) next.splice(insertAfter + 1, 0, newPane)
  else next.push(newPane)
  state.panes = next
  state.activePaneId = paneId
  refreshSelectedScope(root, windowId, workspaceId)
  return { paneId, chatId, scopeId }
}

export function closePaneInRoot(
  root: Root,
  windowId: string,
  workspaceId: string,
  paneId: string,
): void {
  const state = ensureWorkspacePanes(root, windowId, workspaceId)
  if (state.panes.length <= 1) return
  const idx = state.panes.findIndex(p => p.id === paneId)
  if (idx < 0) return
  const nextPanes = state.panes.filter((_, i) => i !== idx)
  state.panes = nextPanes
  if (state.activePaneId === paneId) {
    const next = nextPanes[Math.min(idx, nextPanes.length - 1)]!
    state.activePaneId = next.id
  }
  refreshSelectedScope(root, windowId, workspaceId)
}

/** Opens an existing chat in a new tab inside the currently active
 * pane of the chat's workspace. Switches workspace if needed. */
export function openChatInNewTabInRoot(
  root: Root,
  windowId: string,
  chatId: string,
): void {
  const chat = root.app.chats[chatId]
  if (!chat) return
  const scope = root.app.scopes[chat.scopeId]
  if (!scope) return
  const ws = ensureWindowState(root, windowId)
  ws.selectedWorkspaceId = scope.workspaceId
  const state = ensureWorkspacePanes(root, windowId, scope.workspaceId)
  const paneIdx = state.panes.findIndex(p => p.id === state.activePaneId)
  const targetIdx = paneIdx >= 0 ? paneIdx : 0
  const pane = state.panes[targetIdx]!
  const tabId = nanoid()
  state.panes[targetIdx] = {
    ...pane,
    tabs: [...pane.tabs, makeTab(tabId, { kind: "chat", chatId })],
    activeTabId: tabId,
  }
  ws.selectedScopeId = chat.scopeId
}

/** Opens an existing chat in a brand-new pane and focuses it. */
export function openChatInNewPaneInRoot(
  root: Root,
  windowId: string,
  chatId: string,
): void {
  const chat = root.app.chats[chatId]
  if (!chat) return
  const scope = root.app.scopes[chat.scopeId]
  if (!scope) return
  const ws = ensureWindowState(root, windowId)
  ws.selectedWorkspaceId = scope.workspaceId
  const state = ensureWorkspacePanes(root, windowId, scope.workspaceId)
  const paneId = nanoid()
  const tabId = nanoid()
  const after = state.panes.findIndex(p => p.id === state.activePaneId)
  const newPane = {
    id: paneId,
    tabs: [makeTab(tabId, { kind: "chat", chatId })],
    activeTabId: tabId,
  }
  const next = state.panes.slice()
  if (after >= 0) next.splice(after + 1, 0, newPane)
  else next.push(newPane)
  state.panes = next
  state.activePaneId = paneId
  ws.selectedScopeId = chat.scopeId
}

/**
 * Result of a split helper.
 *
 *  - `"chat"`: a chat tab was split. Renderer fires
 *    `sessions.createChatSession` when `needsSession` is true.
 *  - `"view"`: a view tab was cloned. No follow-up RPC needed.
 */
export type SplitPaneResult =
  | {
      kind: "chat"
      scopeId: string
      chatId: string
      paneId: string
      needsSession: boolean
    }
  | {
      kind: "view"
      paneId: string
    }

/** Internal: active workspace + pane + tab for `windowId`. */
function getActiveContext(root: Root, windowId: string) {
  const ws = root.app.windowStates[windowId]
  if (!ws) return null
  const workspaceId = ws.selectedWorkspaceId
  if (!workspaceId) return null
  const state = ensureWorkspacePanes(root, windowId, workspaceId)
  const activePane =
    state.panes.find(p => p.id === state.activePaneId) ?? state.panes[0]
  if (!activePane) return null
  const activeTab =
    activePane.tabs.find(t => t.id === activePane.activeTabId) ??
    activePane.tabs[0] ??
    null
  return {
    workspaceId,
    state,
    activePane,
    activeTab,
    activeChatId: chatIdOf(activeTab),
  }
}

/** Insert a new pane next to the active one, holding the given view. */
function splitPaneCloneViewInRoot(
  ctx: NonNullable<ReturnType<typeof getActiveContext>>,
  view: { viewType: string; args: Record<string, unknown> },
): SplitPaneResult {
  const paneId = nanoid()
  const tabId = nanoid()
  const newPane = {
    id: paneId,
    tabs: [
      makeTab(tabId, {
        kind: "view",
        viewType: view.viewType,
        args: { ...view.args },
      }),
    ],
    activeTabId: tabId,
  }
  const state = ctx.state
  const after = state.panes.findIndex(p => p.id === ctx.activePane.id)
  const next = state.panes.slice()
  if (after >= 0) next.splice(after + 1, 0, newPane)
  else next.push(newPane)
  state.panes = next
  state.activePaneId = paneId
  return { kind: "view", paneId }
}

/** ⌘/ — split, new pane points at the same session as the active. */
export function splitPaneSameSessionInRoot(
  root: Root,
  windowId: string,
): SplitPaneResult | null {
  const ctx = getActiveContext(root, windowId)
  if (!ctx || !ctx.activeTab) return null

  if (ctx.activeTab.content.kind === "view") {
    return splitPaneCloneViewInRoot(ctx, ctx.activeTab.content)
  }
  if (!ctx.activeChatId) return null
  const source = root.app.chats[ctx.activeChatId]
  if (!source) return null

  const newChatId = nanoid()
  const now = Date.now()
  root.app.chats[newChatId] = {
    id: newChatId,
    scopeId: source.scopeId,
    session: { ...source.session },
    createdAt: now,
  }
  const paneId = insertPaneWithChat(ctx.state, ctx.activePane.id, newChatId)
  refreshSelectedScope(root, windowId, ctx.workspaceId)
  return {
    kind: "chat",
    scopeId: source.scopeId,
    chatId: newChatId,
    paneId,
    needsSession: source.session.kind !== "ready",
  }
}

/** ⌘⇧/ — split + brand-new pending chat in the same scope as active. */
export function splitPaneNewChatInRoot(
  root: Root,
  windowId: string,
): SplitPaneResult | null {
  const ctx = getActiveContext(root, windowId)
  if (!ctx || !ctx.activeTab) return null

  if (ctx.activeTab.content.kind === "view") {
    return splitPaneCloneViewInRoot(ctx, ctx.activeTab.content)
  }
  const scopeId = resolveNewChatScope(root, windowId, ctx.workspaceId)
  if (!scopeId) return null

  const newChatId = nanoid()
  const now = Date.now()
  root.app.chats[newChatId] = {
    id: newChatId,
    scopeId,
    session: { kind: "pending" },
    createdAt: now,
  }
  const paneId = insertPaneWithChat(ctx.state, ctx.activePane.id, newChatId)
  refreshSelectedScope(root, windowId, ctx.workspaceId)
  return {
    kind: "chat",
    scopeId,
    chatId: newChatId,
    paneId,
    needsSession: true,
  }
}

/** ⌘T — fresh chat in a new tab inside the active pane. */
export function newChatInCurrentPaneInRoot(
  root: Root,
  windowId: string,
): SplitPaneResult | null {
  const ctx = getActiveContext(root, windowId)
  if (!ctx) return null
  const scopeId = resolveNewChatScope(root, windowId, ctx.workspaceId)
  if (!scopeId) return null

  const newChatId = nanoid()
  const now = Date.now()
  root.app.chats[newChatId] = {
    id: newChatId,
    scopeId,
    session: { kind: "pending" },
    createdAt: now,
  }
  const state = ctx.state
  const paneIdx = state.panes.findIndex(p => p.id === ctx.activePane.id)
  if (paneIdx < 0) return null
  const pane = state.panes[paneIdx]!
  const tabId = nanoid()
  const activeIdx = pane.tabs.findIndex(t => t.id === pane.activeTabId)
  const insertAt = activeIdx < 0 ? pane.tabs.length : activeIdx + 1
  const nextTabs = [
    ...pane.tabs.slice(0, insertAt),
    makeTab(tabId, { kind: "chat", chatId: newChatId }),
    ...pane.tabs.slice(insertAt),
  ]
  state.panes[paneIdx] = {
    ...pane,
    tabs: nextTabs,
    activeTabId: tabId,
  }
  state.activePaneId = ctx.activePane.id
  refreshSelectedScope(root, windowId, ctx.workspaceId)
  return {
    kind: "chat",
    scopeId,
    chatId: newChatId,
    paneId: ctx.activePane.id,
    needsSession: true,
  }
}

/** ⌘W — close the active tab. Cascades to closing the pane / no-op
 * if it's the last tab of the last pane. */
export function closeActiveTabInRoot(
  root: Root,
  windowId: string,
): void {
  const ctx = getActiveContext(root, windowId)
  if (!ctx) return
  const { state, activePane, workspaceId } = ctx
  const paneIdx = state.panes.findIndex(p => p.id === activePane.id)
  if (paneIdx < 0) return
  const pane = state.panes[paneIdx]!

  if (pane.tabs.length > 1) {
    const activeIdx = pane.tabs.findIndex(t => t.id === pane.activeTabId)
    if (activeIdx < 0) return
    const nextTabs = pane.tabs.filter((_, i) => i !== activeIdx)
    const focusIdx = activeIdx > 0 ? activeIdx - 1 : 0
    const nextActive = nextTabs[focusIdx]!
    state.panes[paneIdx] = {
      ...pane,
      tabs: nextTabs,
      activeTabId: nextActive.id,
    }
    refreshSelectedScope(root, windowId, workspaceId)
    return
  }

  if (state.panes.length > 1) {
    closePaneInRoot(root, windowId, workspaceId, activePane.id)
    return
  }

  // Single tab in the only pane — no-op.
}

/** @deprecated Alias for {@link closeActiveTabInRoot}. */
export const closeActivePaneInRoot = closeActiveTabInRoot

function insertPaneWithChat(
  state: ReturnType<typeof ensureWorkspacePanes>,
  afterPaneId: string,
  chatId: string,
): string {
  const paneId = nanoid()
  const tabId = nanoid()
  const newPane = {
    id: paneId,
    tabs: [makeTab(tabId, { kind: "chat", chatId })],
    activeTabId: tabId,
  }
  const after = state.panes.findIndex(p => p.id === afterPaneId)
  const next = state.panes.slice()
  if (after >= 0) next.splice(after + 1, 0, newPane)
  else next.push(newPane)
  state.panes = next
  state.activePaneId = paneId
  return paneId
}

/** Assign a chat to a specific tab and focus it. */
export function assignChatToTabInRoot(
  root: Root,
  windowId: string,
  workspaceId: string,
  paneId: string,
  tabId: string,
  chatId: string,
): void {
  const state = ensureWorkspacePanes(root, windowId, workspaceId)
  const pane = state.panes.find(p => p.id === paneId)
  if (!pane) return
  const tabIdx = pane.tabs.findIndex(t => t.id === tabId)
  if (tabIdx < 0) return
  const tab = pane.tabs[tabIdx]!
  const nextTabs = pane.tabs.slice()
  nextTabs[tabIdx] = pushTabContent(tab, { kind: "chat", chatId })
  const paneIdx = state.panes.findIndex(p => p.id === paneId)
  if (paneIdx >= 0) {
    state.panes[paneIdx] = { ...pane, tabs: nextTabs, activeTabId: tabId }
  }
  state.activePaneId = paneId
  refreshSelectedScope(root, windowId, workspaceId)
}

/* --------------------------- public hooks ------------------------------- */

export function useSelectWorkspace() {
  const windowId = useWindowId()
  const client = useDbClient()
  return useCallback(
    (workspaceId: string) => {
      void client.update(root => {
        selectWorkspaceInRoot(root, windowId, workspaceId)
      })
    },
    [client, windowId],
  )
}

export function useSelectChat() {
  const windowId = useWindowId()
  const client = useDbClient()
  return useCallback(
    (chatId: string) => {
      void client.update(root => {
        selectChatInRoot(root, windowId, chatId)
      })
    },
    [client, windowId],
  )
}

export function useSelectTerminal() {
  const windowId = useWindowId()
  const client = useDbClient()
  return useCallback(
    (terminalId: string) => {
      void client.update(root => {
        selectTerminalInRoot(root, windowId, terminalId)
      })
    },
    [client, windowId],
  )
}

export type LeftSidebarTab = "agent" | "pi-sessions"

export function useLeftSidebarTab(): LeftSidebarTab {
  const windowId = useWindowId()
  return useDb(root => {
    const raw = root.app.windowStates[windowId]?.leftSidebarTab
    // Defensive: legacy windows may carry the dropped "scopes" value
    // until the migration runs; fall back to "agent" so the renderer
    // never tries to render a non-existent tab body.
    if (raw === "agent" || raw === "pi-sessions") return raw
    return "agent"
  })
}

export function useSetLeftSidebarTab() {
  const windowId = useWindowId()
  const client = useDbClient()
  return useCallback(
    (tab: LeftSidebarTab) => {
      void client.update(root => {
        const ws = ensureWindowState(root, windowId)
        ws.leftSidebarTab = tab
      })
    },
    [client, windowId],
  )
}

/* ------------------------ worktree group collapse ----------------------- */

export function useWorktreeGroupCollapsed(): Record<string, boolean> {
  const windowId = useWindowId()
  return useDb(
    root => root.app.windowStates[windowId]?.worktreeGroupCollapsed ?? {},
  )
}

export function useToggleWorktreeGroupCollapsed() {
  const windowId = useWindowId()
  const client = useDbClient()
  return useCallback(
    (scopeId: string, collapsed?: boolean) => {
      void client.update(root => {
        const ws = ensureWindowState(root, windowId)
        const current = ws.worktreeGroupCollapsed[scopeId] ?? false
        ws.worktreeGroupCollapsed[scopeId] =
          collapsed != null ? collapsed : !current
      })
    },
    [client, windowId],
  )
}

/* ----------------------------- bottom panel ----------------------------- */

export function useBottomPanelView(): string | null {
  const windowId = useWindowId()
  return useDb(
    root => root.app.windowStates[windowId]?.bottomPanelView ?? null,
  )
}

export function useSetBottomPanelView() {
  const windowId = useWindowId()
  const client = useDbClient()
  return useCallback(
    (viewType: string | null) => {
      void client.update(root => {
        const ws = ensureWindowState(root, windowId)
        ws.bottomPanelView = viewType
      })
    },
    [client, windowId],
  )
}

/* --------------------------- sidebar open/closed ------------------------ */

export function useLeftSidebarOpen(): boolean {
  const windowId = useWindowId()
  return useDb(
    root => root.app.windowStates[windowId]?.leftSidebarOpen ?? true,
  )
}

export function useSetLeftSidebarOpen() {
  const windowId = useWindowId()
  const client = useDbClient()
  return useCallback(
    (open: boolean | ((prev: boolean) => boolean)) => {
      void client.update(root => {
        const ws = ensureWindowState(root, windowId)
        const prev = ws.leftSidebarOpen ?? true
        ws.leftSidebarOpen = typeof open === "function" ? open(prev) : open
      })
    },
    [client, windowId],
  )
}

export function useWorkspaceRailOpen(): boolean {
  const windowId = useWindowId()
  return useDb(
    root => root.app.windowStates[windowId]?.workspaceRailOpen ?? true,
  )
}

export function useSetWorkspaceRailOpen() {
  const windowId = useWindowId()
  const client = useDbClient()
  return useCallback(
    (open: boolean | ((prev: boolean) => boolean)) => {
      void client.update(root => {
        const ws = ensureWindowState(root, windowId)
        const prev = ws.workspaceRailOpen ?? true
        ws.workspaceRailOpen = typeof open === "function" ? open(prev) : open
      })
    },
    [client, windowId],
  )
}

export function useRightSidebarOpenType(): string | null {
  const windowId = useWindowId()
  return useDb(
    root => root.app.windowStates[windowId]?.rightSidebarOpenType ?? null,
  )
}

export function useRightSidebarLastType(): string | null {
  const windowId = useWindowId()
  return useDb(
    root => root.app.windowStates[windowId]?.rightSidebarLastType ?? null,
  )
}

export function useSetRightSidebarOpenType() {
  const windowId = useWindowId()
  const client = useDbClient()
  return useCallback(
    (type: string | null) => {
      void client.update(root => {
        const ws = ensureWindowState(root, windowId)
        ws.rightSidebarOpenType = type
        if (type != null) ws.rightSidebarLastType = type
      })
    },
    [client, windowId],
  )
}

export function useBottomPanelOpen(): boolean {
  const windowId = useWindowId()
  return useDb(
    root => root.app.windowStates[windowId]?.bottomPanelOpen ?? false,
  )
}

export function useSetBottomPanelOpen() {
  const windowId = useWindowId()
  const client = useDbClient()
  return useCallback(
    (open: boolean | ((prev: boolean) => boolean)) => {
      void client.update(root => {
        const ws = ensureWindowState(root, windowId)
        const prev = ws.bottomPanelOpen ?? false
        ws.bottomPanelOpen = typeof open === "function" ? open(prev) : open
      })
    },
    [client, windowId],
  )
}

/* ----------------------------- pane hooks ------------------------------- */

export type PaneTabContent =
  | { kind: "chat"; chatId: string | null }
  | { kind: "view"; viewType: string; args: Record<string, unknown> }

export type PaneTabHistory = {
  entries: PaneTabContent[]
  index: number
}

export type PaneTabView = {
  id: string
  content: PaneTabContent
  history: PaneTabHistory
}

export type PaneView = {
  id: string
  tabs: PaneTabView[]
  activeTabId: string
}

/** Public helper: extract a chatId from a tab regardless of kind. */
export function paneTabChatId(tab: PaneTabView | null | undefined): string | null {
  if (!tab) return null
  return tab.content.kind === "chat" ? tab.content.chatId : null
}

export type WorkspacePaneStateView = {
  panes: PaneView[]
  activePaneId: string
}

/**
 * Subscribe to the active workspace's pane layout. Returns null when
 * no workspace is selected.
 */
export function useWorkspacePanes(): WorkspacePaneStateView | null {
  const windowId = useWindowId()
  return useDb(root => {
    const ws = root.app.windowStates[windowId]
    if (!ws) return null
    const workspaceId = ws.selectedWorkspaceId
    if (!workspaceId) return null
    return ws.workspacePanes?.[workspaceId] ?? null
  })
}

export function useSelectPane() {
  const windowId = useWindowId()
  const client = useDbClient()
  return useCallback(
    (workspaceId: string, paneId: string) => {
      void client.update(root => {
        selectPaneInRoot(root, windowId, workspaceId, paneId)
      })
    },
    [client, windowId],
  )
}

export function useSelectTab() {
  const windowId = useWindowId()
  const client = useDbClient()
  return useCallback(
    (workspaceId: string, paneId: string, tabId: string) => {
      void client.update(root => {
        selectTabInRoot(root, windowId, workspaceId, paneId, tabId)
      })
    },
    [client, windowId],
  )
}

/* --------------------------- pane navigation ---------------------------- */

export function stepTabHistoryInRoot(
  root: Root,
  windowId: string,
  workspaceId: string,
  paneId: string,
  tabId: string,
  delta: -1 | 1,
): boolean {
  const state = ensureWorkspacePanes(root, windowId, workspaceId)
  const paneIdx = state.panes.findIndex(p => p.id === paneId)
  if (paneIdx < 0) return false
  const pane = state.panes[paneIdx]!
  const tabIdx = pane.tabs.findIndex(t => t.id === tabId)
  if (tabIdx < 0) return false
  const tab = pane.tabs[tabIdx]!
  const history = tab.history ?? { entries: [], index: -1 }
  const nextIndex = history.index + delta
  if (nextIndex < 0 || nextIndex >= history.entries.length) return false
  const nextContent = cloneContent(history.entries[nextIndex]!)
  const nextTabs = pane.tabs.slice()
  nextTabs[tabIdx] = {
    id: tab.id,
    content: nextContent,
    history: { entries: history.entries, index: nextIndex },
  }
  state.panes[paneIdx] = { ...pane, tabs: nextTabs, activeTabId: tab.id }
  state.activePaneId = paneId
  refreshSelectedScope(root, windowId, workspaceId)
  return true
}

export function stepActiveTabHistoryInRoot(
  root: Root,
  windowId: string,
  delta: -1 | 1,
): boolean {
  const ctx = getActiveContext(root, windowId)
  if (!ctx || !ctx.activeTab) return false
  return stepTabHistoryInRoot(
    root,
    windowId,
    ctx.workspaceId,
    ctx.activePane.id,
    ctx.activeTab.id,
    delta,
  )
}

export function useGoBackInTab() {
  const windowId = useWindowId()
  const client = useDbClient()
  return useCallback(
    (workspaceId: string, paneId: string, tabId: string) => {
      void client.update(root => {
        stepTabHistoryInRoot(root, windowId, workspaceId, paneId, tabId, -1)
      })
    },
    [client, windowId],
  )
}

export function useGoForwardInTab() {
  const windowId = useWindowId()
  const client = useDbClient()
  return useCallback(
    (workspaceId: string, paneId: string, tabId: string) => {
      void client.update(root => {
        stepTabHistoryInRoot(root, windowId, workspaceId, paneId, tabId, 1)
      })
    },
    [client, windowId],
  )
}

export function useAddTab() {
  const windowId = useWindowId()
  const client = useDbClient()
  const rpc = useRpc()
  return useCallback(
    (workspaceId: string, paneId: string) => {
      let result: { tabId: string; chatId: string; scopeId: string } | null = null
      void client
        .update(root => {
          result = addTabInRoot(root, windowId, workspaceId, paneId)
        })
        .then(() => {
          if (!result) return
          void rpc.app.sessions
            .createChatSession({ scopeId: result.scopeId, chatId: result.chatId })
            .catch(err =>
              console.error("[window-state] addTab createChatSession failed:", err),
            )
        })
    },
    [client, rpc, windowId],
  )
}

export function useCloseTab() {
  const windowId = useWindowId()
  const client = useDbClient()
  const rpc = useRpc()
  return useCallback(
    (workspaceId: string, paneId: string, tabId: string) => {
      let result: { chatId: string; scopeId: string } | null = null
      void client
        .update(root => {
          result = closeTabInRoot(root, windowId, workspaceId, paneId, tabId)
        })
        .then(() => {
          if (!result) return
          void rpc.app.sessions
            .createChatSession({
              scopeId: result.scopeId,
              chatId: result.chatId,
            })
            .catch(err =>
              console.error(
                "[window-state] closeTab createChatSession failed:",
                err,
              ),
            )
        })
    },
    [client, rpc, windowId],
  )
}

export function useAddPane() {
  const windowId = useWindowId()
  const client = useDbClient()
  const rpc = useRpc()
  return useCallback(
    (workspaceId: string, afterPaneId?: string) => {
      let result: { paneId: string; chatId: string; scopeId: string } | null =
        null
      void client
        .update(root => {
          result = addPaneInRoot(root, windowId, workspaceId, afterPaneId)
        })
        .then(() => {
          if (!result) return
          void rpc.app.sessions
            .createChatSession({ scopeId: result.scopeId, chatId: result.chatId })
            .catch(err =>
              console.error("[window-state] addPane createChatSession failed:", err),
            )
        })
    },
    [client, rpc, windowId],
  )
}

export function useClosePane() {
  const windowId = useWindowId()
  const client = useDbClient()
  return useCallback(
    (workspaceId: string, paneId: string) => {
      void client.update(root => {
        closePaneInRoot(root, windowId, workspaceId, paneId)
      })
    },
    [client, windowId],
  )
}

/* --------------------------- generic views ------------------------------ */

export type OpenMode = "new-tab" | "replace" | "split-right"

export function openViewInRoot(
  root: Root,
  windowId: string,
  viewType: string,
  mode: OpenMode,
  args: Record<string, unknown> = {},
): boolean {
  const ws = root.app.windowStates[windowId]
  if (!ws) return false
  const workspaceId = ws.selectedWorkspaceId
  if (!workspaceId) return false
  const state = ensureWorkspacePanes(root, windowId, workspaceId)
  const activePane =
    state.panes.find(p => p.id === state.activePaneId) ?? state.panes[0]
  if (!activePane) return false

  const tabContent = { kind: "view" as const, viewType, args }

  if (mode === "split-right") {
    const paneId = nanoid()
    const tabId = nanoid()
    const newPane = {
      id: paneId,
      tabs: [makeTab(tabId, tabContent)],
      activeTabId: tabId,
    }
    state.panes = [...state.panes, newPane]
    state.activePaneId = paneId
    refreshSelectedScope(root, windowId, workspaceId)
    return true
  }

  const paneIdx = state.panes.findIndex(p => p.id === activePane.id)
  if (paneIdx < 0) return false
  const pane = state.panes[paneIdx]!

  if (mode === "new-tab") {
    const tabId = nanoid()
    const activeIdx = pane.tabs.findIndex(t => t.id === pane.activeTabId)
    const insertAt = activeIdx < 0 ? pane.tabs.length : activeIdx + 1
    state.panes[paneIdx] = {
      ...pane,
      tabs: [
        ...pane.tabs.slice(0, insertAt),
        makeTab(tabId, tabContent),
        ...pane.tabs.slice(insertAt),
      ],
      activeTabId: tabId,
    }
    state.activePaneId = pane.id
    refreshSelectedScope(root, windowId, workspaceId)
    return true
  }

  const tabIdx = pane.tabs.findIndex(t => t.id === pane.activeTabId)
  if (tabIdx < 0) return false
  const tab = pane.tabs[tabIdx]!
  const nextTabs = pane.tabs.slice()
  nextTabs[tabIdx] = pushTabContent(tab, tabContent)
  state.panes[paneIdx] = { ...pane, tabs: nextTabs, activeTabId: tab.id }
  state.activePaneId = pane.id
  refreshSelectedScope(root, windowId, workspaceId)
  return true
}

export const VIEW_SOURCE_KEY = "__source"

export function openViewBySourceInRoot(
  root: Root,
  windowId: string,
  viewType: string,
  source: string,
  args: Record<string, unknown> = {},
): boolean {
  const ws = root.app.windowStates[windowId]
  if (!ws) return false
  const workspaceId = ws.selectedWorkspaceId
  if (!workspaceId) return false
  const state = ensureWorkspacePanes(root, windowId, workspaceId)

  const taggedArgs = { ...args, [VIEW_SOURCE_KEY]: source }
  const tabContent = { kind: "view" as const, viewType, args: taggedArgs }

  for (let pIdx = 0; pIdx < state.panes.length; pIdx++) {
    const pane = state.panes[pIdx]!
    for (let tIdx = 0; tIdx < pane.tabs.length; tIdx++) {
      const tab = pane.tabs[tIdx]!
      if (tab.content.kind !== "view") continue
      const tagged = tab.content.args?.[VIEW_SOURCE_KEY]
      if (tagged !== source) continue
      const nextTabs = pane.tabs.slice()
      nextTabs[tIdx] = pushTabContent(tab, tabContent)
      state.panes[pIdx] = { ...pane, tabs: nextTabs, activeTabId: tab.id }
      state.activePaneId = pane.id
      refreshSelectedScope(root, windowId, workspaceId)
      return true
    }
  }

  if (state.panes.length === 0) return false
  const paneId = nanoid()
  const tabId = nanoid()
  const newPane = {
    id: paneId,
    tabs: [makeTab(tabId, tabContent)],
    activeTabId: tabId,
  }
  state.panes = [...state.panes, newPane]
  state.activePaneId = paneId
  refreshSelectedScope(root, windowId, workspaceId)
  return true
}

export function useOpenView() {
  const windowId = useWindowId()
  const client = useDbClient()
  return useCallback(
    (viewType: string, mode: OpenMode, args?: Record<string, unknown>) => {
      void client.update(root => {
        openViewInRoot(root, windowId, viewType, mode, args ?? {})
      })
    },
    [client, windowId],
  )
}
