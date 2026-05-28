/**
 * Agent-sidebar events. One-way main\u2192renderer.
 *
 * `importWorktrees` \u2014 fired by the registered command-palette
 * action ("Import Worktrees\u2026"). The agent-sidebar view in the
 * matching `windowId` subscribes and runs the renderer-side
 * import flow (which needs the active window's workspace/repo).
 */
export type Events = {
  importWorktrees: { windowId: string; source: string }
}
