import type { ComponentType } from "react"
import type {
  PermissionOption,
  PlanEntry,
  ToolCallContentItem,
  ToolResponse,
  UserImageRef,
} from "./lib/materialized-message"
import type { BranchSummaryChoice } from "./lib/branch-summary-choice"

export type { BranchSummaryChoice }

export type UserMessageProps = {
  content: string
  images?: UserImageRef[]
  /** 0-based index of this user message among user messages on the
   * current session path. The chat-pane keeps an ordered list of
   * user entry ids and resolves the right pi entry id when the user
   * triggers the edit-to-branch or revert flow. Omitted only for
   * ad-hoc renders outside a real session (e.g. fixture stories). */
  userMessageIndex?: number
  /** Fired when the user finished the inline edit + summarize-choice
   * flow. Parent resolves the pi entry id from `userMessageIndex`,
   * calls `navigateTree` with the summary `choice`, and then prompts
   * the rewound session with `text` / `displayText`. */
  onEditSubmit?: (args: {
    userMessageIndex: number
    text: string
    displayText: string
    choice: BranchSummaryChoice
  }) => void | Promise<void>
  /** Fired when the user finished the revert + summarize-choice
   * flow. Parent rewinds the session (same `navigateTree` call) and
   * fires an `appendComposerDraft` event so the live composer picks
   * the message text up without clobbering whatever else the user
   * was drafting. */
  onRevertSubmit?: (args: {
    userMessageIndex: number
    choice: BranchSummaryChoice
  }) => void | Promise<void>
}

export type AssistantMessageProps = {
  content: string
}

export type ThinkingBlockProps = {
  content: string
  streaming?: boolean
}

export type ToolCallProps = {
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

export type PlanProps = {
  entries: PlanEntry[]
}

export type PermissionRequestProps = {
  requestId: string
  title: string
  description?: string
  options: PermissionOption[]
  responded?: boolean
  onSelect: (optionId: string | "__cancel__") => void
}

export type LoadingProps = {
  /** Wall-clock timestamp (ms) the user's prompt was sent. Powers the
   * live "Xs / Xm Ys" elapsed label. Null while we don't have a
   * timestamp to anchor on (e.g. very first paint before the user
   * message lands in the event log). */
  startTimestamp: number | null
  /** Tokens added to the conversation context by this agent run so
   * far — `stats.contextUsage.tokens` minus the snapshot taken on
   * `agent_start` (`runStartContextTokens`). Same measurement the
   * context view and status bar use, scoped to the current run.
   * Reported only while streaming. */
  tokens: number
}

export type InterruptedProps = Record<string, never>

export type CloneMarkerProps = {
  /** Origin marker variant. `clone` for `/clone` (history copied
   * verbatim including the leaf), `fork` for `/fork` (history
   * stops just before the picked user message, which moved into
   * the composer). Drives the label only. */
  variant: "clone" | "fork"
  /** Parent session id, if it still exists in the DB. */
  parentSessionId: string | null
  /** Parent session title at the time of cloning/forking. May be
   * stale if the parent was renamed afterwards — acceptable, the
   * marker is frozen at clone/fork time. */
  parentTitle: string | null
  /** Pi entry id the clone/fork branched at. Reserved for a future
   * "scroll parent to this entry" jump affordance. */
  parentEntryId: string | null
  /** Wall-clock timestamp of the clone/fork. */
  timestamp: number
}

export type TurnSummaryProps = {
  /** Files modified during this turn, ordered by first-edit time.
   * `editCount` includes repeated edits to the same file (each
   * successful `edit` / `write` tool execution counts once).
   * `op` is the first observed operation — `create` if the file
   * was first touched with `write`, `edit` if it was first touched
   * with `edit`. */
  files: {
    path: string
    editCount: number
    op: "create" | "edit"
    /** Lines added across every successful op for this path.
     * Drives the blue `+N` (create) or green `+N` (edit) badge
     * on the per-file card. */
    additions: number
    /** Lines removed across every successful op for this path.
     * Always 0 for `create`. Drives the red `-N` badge for edits. */
    removals: number
  }[]
  /** Worktree directory the chat is anchored at, forwarded as the
   * `directory` arg to `rpc.app.gitTree.openDiff(...)`. Null when
   * the chat has no live scope yet — the renderer hides the card
   * in that case so we never open a diff in the wrong worktree. */
  directory: string | null
  /** Workspace the chat owning this card lives in. Forwarded to
   * `openDiff` so the shell can switch to (or stay on) the right
   * workspace when splitting the diff pane. Null when the chat
   * has no live scope; renderer hides the card in that case. */
  workspaceId: string | null
  /** Scope (worktree) the chat owning this card lives in. The
   * shell pins `selectedScopeId` to this value after opening the
   * diff pane so the sidebar / commit button don't drift to the
   * workspace's primary scope. Null when the chat has no live
   * scope yet. */
  scopeId: string | null
}

export type MessageComponents = {
  UserMessage: ComponentType<UserMessageProps>
  AssistantMessage: ComponentType<AssistantMessageProps>
  ThinkingBlock: ComponentType<ThinkingBlockProps>
  ToolCall: ComponentType<ToolCallProps>
  Plan: ComponentType<PlanProps>
  PermissionRequest: ComponentType<PermissionRequestProps>
  Loading: ComponentType<LoadingProps>
  Interrupted: ComponentType<InterruptedProps>
  CloneMarker: ComponentType<CloneMarkerProps>
  TurnSummary: ComponentType<TurnSummaryProps>
}
