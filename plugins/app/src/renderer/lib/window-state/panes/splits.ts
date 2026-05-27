import { nanoid } from "nanoid"
import type { Root, SplitPaneResult } from "../types"
import { setActiveScope } from "../selection"
import {
  ensureScopePanes,
  getActiveContext,
  insertPaneWithChat,
  makeTab,
} from "./internal"

/** Add a new pane to a scope, seeded with a fresh pending chat in
 * that scope. */
export function addPaneInRoot(
  root: Root,
  windowId: string,
  scopeId: string,
  afterPaneId?: string,
): { paneId: string; chatId: string; scopeId: string } | null {
  if (!root.app.scopes[scopeId]) return null
  const state = ensureScopePanes(root, windowId, scopeId)
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
    afterPaneId != null
      ? state.panes.findIndex(p => p.id === afterPaneId)
      : -1
  const next = state.panes.slice()
  if (insertAfter >= 0) next.splice(insertAfter + 1, 0, newPane)
  else next.push(newPane)
  state.panes = next
  state.activePaneId = paneId
  setActiveScope(root, windowId, scopeId)
  return { paneId, chatId, scopeId }
}

export function closePaneInRoot(
  root: Root,
  windowId: string,
  scopeId: string,
  paneId: string,
): void {
  const state = ensureScopePanes(root, windowId, scopeId)
  if (state.panes.length <= 1) return
  const idx = state.panes.findIndex(p => p.id === paneId)
  if (idx < 0) return
  const nextPanes = state.panes.filter((_, i) => i !== idx)
  state.panes = nextPanes
  if (state.activePaneId === paneId) {
    const next = nextPanes[Math.min(idx, nextPanes.length - 1)]!
    state.activePaneId = next.id
  }
  setActiveScope(root, windowId, scopeId)
}

/** ⌘/ — split the active pane, pointing the new pane at a clone of
 * the active chat (so both panes share the underlying session). */
export function splitPaneSameSessionInRoot(
  root: Root,
  windowId: string,
): SplitPaneResult | null {
  const ctx = getActiveContext(root, windowId)
  if (!ctx || !ctx.activeTab) return null

  if (ctx.activeTab.content.kind === "view") {
    return cloneViewIntoNewPane(ctx, ctx.activeTab.content)
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
  setActiveScope(root, windowId, ctx.scopeId)
  return {
    kind: "chat",
    scopeId: source.scopeId,
    chatId: newChatId,
    paneId,
    needsSession: source.session.kind !== "ready",
  }
}

/** ⌘⇧/ — split the active pane with a brand-new pending chat in
 * the active scope. */
export function splitPaneNewChatInRoot(
  root: Root,
  windowId: string,
): SplitPaneResult | null {
  const ctx = getActiveContext(root, windowId)
  if (!ctx || !ctx.activeTab) return null

  if (ctx.activeTab.content.kind === "view") {
    return cloneViewIntoNewPane(ctx, ctx.activeTab.content)
  }

  const newChatId = nanoid()
  const now = Date.now()
  root.app.chats[newChatId] = {
    id: newChatId,
    scopeId: ctx.scopeId,
    session: { kind: "pending" },
    createdAt: now,
  }
  const paneId = insertPaneWithChat(ctx.state, ctx.activePane.id, newChatId)
  setActiveScope(root, windowId, ctx.scopeId)
  return {
    kind: "chat",
    scopeId: ctx.scopeId,
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

  const newChatId = nanoid()
  const now = Date.now()
  root.app.chats[newChatId] = {
    id: newChatId,
    scopeId: ctx.scopeId,
    session: { kind: "pending" },
    createdAt: now,
  }
  const paneIdx = ctx.state.panes.findIndex(p => p.id === ctx.activePane.id)
  if (paneIdx < 0) return null
  const pane = ctx.state.panes[paneIdx]!
  const tabId = nanoid()
  const activeIdx = pane.tabs.findIndex(t => t.id === pane.activeTabId)
  const insertAt = activeIdx < 0 ? pane.tabs.length : activeIdx + 1
  const nextTabs = [
    ...pane.tabs.slice(0, insertAt),
    makeTab(tabId, { kind: "chat", chatId: newChatId }),
    ...pane.tabs.slice(insertAt),
  ]
  ctx.state.panes[paneIdx] = {
    ...pane,
    tabs: nextTabs,
    activeTabId: tabId,
  }
  ctx.state.activePaneId = ctx.activePane.id
  setActiveScope(root, windowId, ctx.scopeId)
  return {
    kind: "chat",
    scopeId: ctx.scopeId,
    chatId: newChatId,
    paneId: ctx.activePane.id,
    needsSession: true,
  }
}

/** ⌘W — close the active tab, cascading to closing the pane. No-op
 * when only one tab in one pane remains. */
export function closeActiveTabInRoot(root: Root, windowId: string): void {
  const ctx = getActiveContext(root, windowId)
  if (!ctx) return
  const { state, activePane, scopeId } = ctx
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
    setActiveScope(root, windowId, scopeId)
    return
  }

  if (state.panes.length > 1) {
    closePaneInRoot(root, windowId, scopeId, activePane.id)
    return
  }

  // Single tab in the only pane — no-op.
}

/** @deprecated Alias kept for backwards compatibility. */
export const closeActivePaneInRoot = closeActiveTabInRoot

function cloneViewIntoNewPane(
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
