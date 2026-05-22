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
  | (WithKey & { role: "turn_summary"; tokens?: number; durationMs?: number })
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
