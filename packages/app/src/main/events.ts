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
  /** A chunk of stdout from a running terminal session.
   *
   * `seq` is a monotonic per-terminal counter, starting at 1 and
   * incrementing once per emitted chunk. The renderer uses it to
   * dedupe against the replay buffer returned by `attach` (which
   * also reports the `lastSeq` it contains), so output never
   * doubles up or gets dropped across an attach ↔ subscribe race. */
  terminalData: { terminalId: string; data: string; seq: number }
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
  /** A single line of progress from `CreatePluginService` — covers the
   * git worktree step, the `create-zenbu-app --plugin` scaffold, and
   * the AGENTS.md prelude write. Streamed to the dialog so the user
   * sees what's happening. */
  createPluginProgress: {
    runId: string
    line: string
    stream: "stdout" | "stderr" | "step"
  }
  /** Create-plugin pipeline finished. On success, `scopeId` and `chatId`
   * name the materialized sentinel-workspace scope + pending chat the
   * dialog should focus next. */
  createPluginDone: {
    runId: string
    ok: boolean
    error?: string
    pluginName?: string
    worktreePath?: string
    scopeId?: string
    chatId?: string
  }
  /** Emitted by `FileTreeService.openFile` when a user clicks a file
   * in the file-tree sidebar view. The main shell catches this and
   * opens the `file` view in the active pane as a new tab. */
  openFileInActivePane: {
    directory: string
    path: string
  }
  /** Emitted by `GitTreeService.openDiff` when a user clicks a file
   * in the git-tree sidebar view OR a turn-summary card. The main
   * shell catches this and opens the `git-diff` embed view in a
   * pane next to the active one (mirrors `openFileInActivePane`).
   *
   * Carries the *full* context the diff needs to open in the right
   * place: the originating `workspaceId` and `scopeId` so we don't
   * accidentally split a pane into whatever workspace happens to
   * be active at the moment, plus the `directory` + `path` the
   * `git-diff` view needs to fetch the actual diff content.
   *
   * Without `workspaceId`/`scopeId` we used to inherit the active
   * workspace's pane state, which meant clicking a turn-summary in
   * chat A (workspace W1) while you were focused on chat B
   * (workspace W2) would shove the diff into W2 — silently
   * dragging your view to the wrong workspace + clobbering the
   * active scope via `refreshSelectedScope`'s primary-scope
   * fallback. */
  openDiffInActivePane: {
    workspaceId: string
    scopeId: string
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
  /**
   * Open the Pull Requests view deep-linked to one of its
   * sub-pages (`create` / `list` / `detail`).
   *
   * `openMode` decides *how* it lands in the pane tree — same
   * vocabulary as the command palette's per-view actions:
   *   - `"new-tab"` (default): append a new tab in the active pane.
   *   - `"split-right"`: spawn a new pane to the right.
   *   - `"replace"`: replace the active tab's content. Available
   *     for completeness; the command palette doesn't expose it
   *     for this view because each PR open is a fresh entry-point,
   *     not a navigation step.
   *
   * Service-side, `GithubService.openPullRequestsView` emits this
   * event *and* kicks off a prefetch of the data the new page
   * needs, so by the time the iframe mounts and starts asking,
   * results are usually already in the in-memory cache.
   */
  openPullRequestsView: {
    mode: "create" | "list" | "detail"
    prNumber: number | null
    directory: string | null
    openMode: "new-tab" | "split-right" | "replace"
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
  /** A chunk of stdout/stderr from a running play-button run. The
   * renderer subscribes to the same data via the `logs` collection
   * on the workspace's playConfig — this event is only useful for
   * cases where you want to react to output without re-rendering
   * the whole list (we don't currently). Kept around for parity
   * with `terminalData` and as a future hook for streaming
   * notifications. */
  playLog: {
    workspaceId: string
    runId: string
    stream: "stdout" | "stderr" | "system"
    data: string
  }
  /** A play-button run finished (or errored). */
  playExit: {
    workspaceId: string
    runId: string
    /** Process exit code, or null when we never got far enough to
     * spawn (e.g. shell-env failure). */
    exitCode: number | null
    /** Best-effort error message when the spawn itself blew up. */
    error?: string
  }
}
