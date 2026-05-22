export type Events = {
  /** Cmd+Shift+P — toggle the general command palette. */
  toggleCommandPalette: { source: string }
  /** Cmd+P — toggle the agents palette (fuzzy search for chats,
   * opens the picked one in the current pane). */
  toggleAgentsPalette: { source: string }
  /** Cmd+J pressed anywhere in the app (including inside iframes). */
  toggleTerminal: { source: string }
  /** Cmd+/ — split the active pane and open a new chat that points
   * at the *same* session as the current one. Two panes, one
   * underlying session, independent UI state. */
  splitPaneSameSession: { source: string }
  /** Cmd+Shift+/ — split the active pane and open a fresh chat with
   * a brand-new session, all in one transaction (no empty
   * placeholder pane). */
  splitPaneNewChat: { source: string }
  /** Cmd+W — close the active pane. No-op on a single-pane scope so
   * we never delete the last pane. */
  closeActivePane: { source: string }
  /** Cmd+B — toggle the left agent sidebar (VS Code-style). */
  toggleSidebar: { source: string }
  /** Cmd+Shift+B — toggle the workspace rail (the narrow column on
   * the far left that holds the workspace icons). */
  toggleWorkspaceRail: { source: string }
  /** Cmd+T — create a fresh chat (and session) in the *current*
   * pane, replacing whatever was there. Like ⌘⇧/ but without the
   * split. */
  newChatInCurrentPane: { source: string }
  /** Cmd+[ — step the active tab's navigation history one entry
   * back (browser-style). No-op when the cursor is already at the
   * oldest entry. The active tab is whatever tab is focused in the
   * active pane of the active scope. */
  tabHistoryBack: { source: string }
  /** Cmd+] — step the active tab's navigation history one entry
   * forward. No-op when the cursor is already at the newest entry. */
  tabHistoryForward: { source: string }
  /** Cmd+N — create a fresh chat (and session) and *replace* the
   * active tab's chat with it (no new tab). Mirrors the sidebar's
   * "New Chat" button. The renderer handler also nudges the
   * composer to refocus after the swap (the EditorView is reused
   * across chat switches so it wouldn't refocus on its own). */
  newChatReplaceActive: { source: string }
  /** A chunk of stdout from a running terminal session. */
  terminalData: { terminalId: string; data: string }
  /** A terminal session ended. */
  terminalExit: { terminalId: string; exitCode: number; signal: number }
  /** A single line of stdout/stderr from a running create-app spawn. */
  createAppProgress: {
    runId: string
    line: string
    stream: "stdout" | "stderr"
  }
  /** Spawn finished. ok=true on exit code 0. */
  createAppDone: {
    runId: string
    ok: boolean
    error?: string
    /** Absolute path to the resulting `.app` bundle on success. */
    appPath?: string
  }
  /** Emitted by `FileTreeService.openFile` when a user clicks a file
   * in the file-tree sidebar view. The main shell catches this and
   * opens the `file` view in the active pane as a new tab. */
  openFileInActivePane: {
    directory: string
    path: string
  }
  /** Emitted by `GitTreeService.openDiff` when a user clicks a file
   * in the git-tree sidebar view. The main shell catches this and
   * opens the `git-diff` embed view in a pane next to the active
   * one (mirrors `openFileInActivePane`). */
  openDiffInActivePane: {
    directory: string
    path: string
  }
  /** Generic "open this view in the active pane" hatch. Any plugin
   * service can emit it to ask the shell to embed one of its
   * registered views without the host needing to know about the
   * view type ahead of time. The shell catches it and calls
   * `openViewBySourceInRoot(root, windowId, viewType, source, args)`,
   * which reuses an existing tab with the same `source` sentinel or
   * appends a new pane to the right. Used by the plan plugin so its
   * chat advice can wire "Open Plan" through to a Markdown viewer
   * without coupling the host to the `plan` view type. */
  openViewInActivePane: {
    viewType: string
    source: string
    args: Record<string, unknown>
  }
  /** Append text to a live Composer's doc without clobbering its
   * existing draft. Filtered by `composerId` on the renderer side
   * so the right editor receives it (chat-pane stamps the chat id
   * as the composer id). Used by the user-message bubble's revert
   * flow: branching to before a past user message + dropping that
   * message's text into the composer for the user to edit and
   * resend. */
  appendComposerDraft: {
    composerId: string
    text: string
  }
}
