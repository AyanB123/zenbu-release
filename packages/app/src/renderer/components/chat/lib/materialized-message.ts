export type ToolCallContentItem =
  | { type: "text"; text: string }
  | { type: "diff"; path: string; oldText?: string; newText: string }

export type PlanEntry = {
  content: string
  status: string
  priority?: "high" | "medium" | "low"
}

export type PermissionOption = {
  optionId: string
  name: string
  kind: "allow_once" | "allow_always" | "reject_once" | "reject_always"
}

type WithKey = { key?: string }

export type ToolResponse = {
  stdout?: string
  stderr?: string
}

export type ToolMessage = WithKey & {
  role: "tool"
  toolCallId: string
  title: string
  subtitle?: string
  kind: string
  status: "pending" | "running" | "completed" | "failed"
  contentItems?: ToolCallContentItem[]
  toolName?: string
  rawInput?: unknown
  rawOutput?: unknown
  toolResponse?: ToolResponse | null
}

export type UserImageRef = { blobId: string; mimeType: string }

export type MaterializedMessage =
  | (WithKey & {
      role: "user"
      content: string
      /** Inline image references (chat-history side; bytes hydrated
       * lazily via the renderer image cache). */
      images?: UserImageRef[]
      timeSent?: number
      editorState?: unknown
      /** 0-based index of this user message among user messages on
       * the current session path. Used by the inline edit-to-fork
       * flow to resolve the corresponding pi entry id at fork time
       * (chat-pane keeps a list of user entry ids on the current
       * path; index lookup is O(1)). */
      userMessageIndex?: number
    })
  | (WithKey & { role: "assistant"; content: string })
  | (WithKey & { role: "thinking"; content: string; streaming?: boolean })
  | ToolMessage
  | (WithKey & { role: "plan"; entries: PlanEntry[] })
  | (WithKey & {
      role: "permission_request"
      requestId: string
      title: string
      description?: string
      options: PermissionOption[]
      responded?: boolean
    })
  | (WithKey & {
      role: "turn_summary"
      /** Files modified during this turn (between the previous
       * `user_prompt` and the closing `agent_end`). Ordered by
       * first-edit time. `editCount` counts every successful
       * `edit` / `write` tool execution against that path; `op`
       * is the first observed operation — `create` if the file
       * was first touched with `write`, `edit` if it was first
       * touched with `edit` (a subsequent edit on a file we
       * created still reads as "created" because the create is
       * the dominant user-facing action). */
      files: {
        path: string
        editCount: number
        op: "create" | "edit"
        /** Lines added across every successful op for this path.
         * For `create` the count is the size of the written file
         * (every line is new); for `edit` it's the unique-by-line
         * additions across all diffs, matching the inline edit
         * tool card's `+N` badge. */
        additions: number
        /** Lines removed across every successful op for this path.
         * Always 0 for `create` (nothing existed yet). */
        removals: number
      }[]
      /** Worktree directory the edits happened in, used as the
       * `directory` arg when opening the matching `git-diff` view.
       * Null when materialize was called without a scope (renderer
       * still has no live session) — the renderer hides the card
       * in that case. */
      directory: string | null
      /** Workspace the chat owning this card lives in. Threaded
       * through to `rpc.app.gitTree.openDiff` so the shell opens
       * the diff in *this* workspace's pane state, not the
       * window's currently-active workspace (which can drift if
       * the user clicked into another workspace and the chat is
       * still visible via a popout window or the agents palette). */
      workspaceId: string | null
      /** Scope (worktree) the chat owning this card lives in. The
       * `openDiff` handler pins `selectedScopeId` to this value
       * after splitting the diff pane, so the sidebar / commit
       * button stay anchored to the right worktree instead of
       * falling back to the workspace's primary scope (which is
       * what happens when the active tab has no `chatId`). */
      scopeId: string | null
    })
  | (WithKey & { role: "interrupted" })
  | (WithKey & {
      role: "clone_marker"
      /** Whether the new session was produced by `/clone` (history
       * preserved verbatim) or `/fork` (history truncated at a user
       * message which moved into the composer). Drives the marker
       * label so users can tell the two apart. */
      variant: "clone" | "fork"
      parentSessionId: string | null
      parentTitle: string | null
      parentEntryId: string | null
      /** Wall-clock timestamp the clone/fork was performed. */
      timestamp: number
    })
