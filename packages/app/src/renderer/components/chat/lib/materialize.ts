import type {
  MaterializedMessage,
  ToolCallContentItem,
  ToolResponse,
} from "./materialized-message"

type EventItem = { seq: number; kind: string; payload: unknown; timestamp: number }

type AssistantContent =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
  | { type: "toolCall"; id: string; name: string; arguments: unknown }

type AssistantMessage = {
  role: "assistant"
  content: AssistantContent[]
}

type ToolStatus = "pending" | "running" | "completed" | "failed"

/**
 * Walk the pi event log and produce the list of materialized messages
 * the chat surface renders.
 *
 * The event log is a faithful replay of pi's subscription: every
 * `message_start`, `message_update` (with deltas + `partial:
 * AssistantMessage`), `message_end`, and `tool_execution_*` event is
 * present in order, plus our own synthesized `user_prompt` items.
 *
 * For finalized assistant turns we read `message_end.payload.message`
 * and emit one materialized block per `text` / `thinking` content
 * item. For the *in-flight* assistant turn (a trailing
 * `message_start` not yet matched by `message_end`), we use the
 * `partial: AssistantMessage` carried on the latest `message_update`
 * \u2014 pi gives us the full ordered content list on every delta, so we
 * just render it directly. That preserves interleaving like
 * `[thinking, text, thinking, text]` instead of collapsing into two
 * flat buffers.
 *
 * Pure: no RPC, no DB access. Caller passes whatever events it has.
 */
export function materializeMessages(
  events: EventItem[],
  options: {
    directory?: string | null
    workspaceId?: string | null
    scopeId?: string | null
  } = {},
): MaterializedMessage[] {
  const directory = options.directory ?? null
  const workspaceId = options.workspaceId ?? null
  const scopeId = options.scopeId ?? null
  const out: MaterializedMessage[] = []
  // Running 0-based index of user messages encountered. Stamped on
  // each materialized user message so the renderer can look up the
  // matching pi entry id when forking-from-edit. Reset on each call
  // since we always re-materialize from the head of the event log.
  let userIdx = 0

  // Per-turn file-edit aggregator for the post-turn summary card.
  // Reset on every `user_prompt` (so each turn gets its own card),
  // appended into a `turn_summary` materialized block on every
  // `agent_end`. We use an array + an index map so the card lists
  // files in the order they were first edited (more readable than
  // dictionary iteration order, and stable across re-renders).
  type TurnFileEntry = {
    path: string
    editCount: number
    op: "create" | "edit"
    additions: number
    removals: number
  }
  let turnFiles: TurnFileEntry[] = []
  let turnFileIdx = new Map<string, number>()
  // Map of in-flight edit/write tool calls — we only attribute the
  // edit to the file when `tool_execution_end` reports success, so
  // failed edits don't pollute the summary. Keyed by `toolCallId`.
  // `op` captures which tool started the call so the per-file
  // operation kind on the summary card matches what actually ran.
  // `createdLines` is pre-computed for `write` from the args at
  // start time (the result doesn't carry it) and used as the
  // additions count on success.
  const pendingEdits = new Map<
    string,
    { path: string; op: "create" | "edit"; createdLines: number }
  >()
  const recordEdit = (
    rawPath: string,
    op: "create" | "edit",
    additions: number,
    removals: number,
  ) => {
    const normalized = normalizeEditPath(rawPath, directory)
    const existing = turnFileIdx.get(normalized)
    if (existing != null) {
      const prev = turnFiles[existing]!
      turnFiles[existing] = {
        ...prev,
        editCount: prev.editCount + 1,
        // First op wins: a file created this turn stays "created"
        // even if the agent edits it again before turn end, because
        // the dominant user-facing action is the creation. A file
        // that was edited first never gets reclassified as created
        // (you can't really un-create something the agent already
        // started editing).
        additions: prev.additions + additions,
        removals: prev.removals + removals,
      }
      return
    }
    turnFileIdx.set(normalized, turnFiles.length)
    turnFiles.push({
      path: normalized,
      editCount: 1,
      op,
      additions,
      removals,
    })
  }

  // Tracks the most recent assistant `message_start` that has not yet
  // been closed by a `message_end`. While this is non-null, the
  // latest `partial` seen on a `message_update` is the streaming
  // assistant message; on `message_end` we flush finalized blocks
  // and clear this slot.
  let openAssistantStartSeq: number | null = null
  let openAssistantPartial: AssistantMessage | null = null

  for (let i = 0; i < events.length; i++) {
    const event = events[i]
    switch (event.kind) {
      case "user_prompt": {
        const payload = event.payload as
          | {
              text?: string
              images?: { blobId: string; mimeType: string }[]
            }
          | undefined
        const text = payload?.text ?? ""
        out.push({
          role: "user",
          content: text,
          images: payload?.images,
          timeSent: event.timestamp,
          key: `user-${event.seq}`,
          userMessageIndex: userIdx++,
        })
        // Start of a new turn from the user's side. Reset the
        // file-edit aggregator so the next agent_end's turn_summary
        // only reflects edits made for this prompt.
        turnFiles = []
        turnFileIdx = new Map()
        pendingEdits.clear()
        break
      }
      case "message_start": {
        const payload = event.payload as
          | { message?: { role?: string } }
          | undefined
        if (payload?.message?.role === "assistant") {
          openAssistantStartSeq = event.seq
          openAssistantPartial = null
        }
        break
      }
      case "message_update": {
        if (openAssistantStartSeq == null) break
        const payload = event.payload as
          | {
              assistantMessageEvent?: {
                partial?: AssistantMessage
              }
            }
          | undefined
        const partial = payload?.assistantMessageEvent?.partial
        if (partial && partial.role === "assistant") {
          openAssistantPartial = partial
        }
        break
      }
      case "message_end": {
        const payload = event.payload as { message?: AssistantMessage } | undefined
        const msg = payload?.message
        // Close the in-flight slot regardless \u2014 a `message_end` ends
        // *some* message; if it's the assistant message we were
        // streaming, the finalized blocks below replace any partial
        // we'd otherwise render at the tail.
        openAssistantStartSeq = null
        openAssistantPartial = null
        if (!msg || msg.role !== "assistant") break
        for (let j = 0; j < msg.content.length; j++) {
          const block = msg.content[j]
          if (block.type === "text" && block.text) {
            out.push({
              role: "assistant",
              content: block.text,
              key: `assistant-${event.seq}-${j}`,
            })
          } else if (block.type === "thinking" && block.thinking) {
            out.push({
              role: "thinking",
              content: block.thinking,
              key: `thinking-${event.seq}-${j}`,
            })
          }
        }
        break
      }
      case "tool_execution_start": {
        const payload = event.payload as
          | { toolCallId?: string; toolName?: string; args?: unknown }
          | undefined
        const id = payload?.toolCallId ?? `tool-${event.seq}`
        const toolName = payload?.toolName
        const args = payload?.args
        const opKind = editOpKind(toolName)
        if (opKind) {
          const filePath = pickEditPath(args)
          if (filePath) {
            // For `write` we need the line count of the content
            // payload — it's only present in args, not in the
            // result — so we snapshot it here. `edit` figures its
            // diff stats out from the result on success, so we
            // pass 0 and overwrite at end time.
            const createdLines =
              opKind === "create" ? lineCountOfWriteArgs(args) : 0
            pendingEdits.set(id, { path: filePath, op: opKind, createdLines })
          }
        }
        out.push({
          role: "tool",
          toolCallId: id,
          toolName,
          title: toolName ?? "tool",
          subtitle: summarizeArgs(args),
          kind: inferToolKind(toolName),
          status: "running",
          rawInput: args,
          rawOutput: null,
          toolResponse: null,
          contentItems: extractContentItems(toolName, args, null),
          key: `tool-${id}`,
        })
        break
      }
      case "tool_execution_end": {
        const payload = event.payload as
          | {
              toolCallId?: string
              isError?: boolean
              toolName?: string
              result?: unknown
            }
          | undefined
        const id = payload?.toolCallId
        if (!id) break
        const status: ToolStatus = payload?.isError ? "failed" : "completed"
        const pending = pendingEdits.get(id)
        if (pending) {
          pendingEdits.delete(id)
          if (!payload?.isError) {
            // Stats source depends on which tool ran:
            //   - write: pre-computed line count from args.content.
            //     Every line is an addition (the file didn't exist),
            //     removals stay 0.
            //   - edit: parse the unified diff out of the tool
            //     result, run the same unique-line tally the inline
            //     EditCard uses so the badges match what the user
            //     sees in the tool call above.
            let additions = 0
            let removals = 0
            if (pending.op === "create") {
              additions = pending.createdLines
            } else {
              const stats = editDiffStatsFromResult(payload?.result)
              additions = stats.additions
              removals = stats.removals
            }
            recordEdit(pending.path, pending.op, additions, removals)
          }
        }
        for (let k = out.length - 1; k >= 0; k--) {
          const m = out[k]
          if (m.role === "tool" && m.toolCallId === id) {
            out[k] = {
              ...m,
              status,
              rawOutput: payload?.result ?? null,
              toolResponse: extractToolResponse(m.toolName, payload?.result),
              contentItems: extractContentItems(
                m.toolName,
                m.rawInput,
                payload?.result ?? null,
              ),
            }
            break
          }
        }
        break
      }
      case "interrupted":
      case "turn_interrupted": {
        out.push({ role: "interrupted", key: `interrupted-${event.seq}` })
        break
      }
      case "agent_end": {
        // End of a turn. If pi wrote / edited any files since the
        // previous user_prompt, drop a `turn_summary` block here so
        // the chat renders the post-turn "what changed" card right
        // below the assistant's last message. We snapshot the
        // current aggregator into a fresh array so any *future*
        // turn's edits (after the user replies) don't mutate this
        // card by reference.
        if (turnFiles.length > 0) {
          out.push({
            role: "turn_summary",
            files: turnFiles.slice(),
            directory,
            workspaceId,
            scopeId,
            key: `turn-summary-${event.seq}`,
          })
        }
        // Reset the aggregator so a follow-up agent_end inside the
        // same user prompt (rare — agent retries / sub-runs) emits
        // a fresh card with only the newly-edited files rather than
        // double-counting what the prior card already showed. The
        // user_prompt branch also clears on the *next* prompt, so
        // either way each card is "edits since the last summary or
        // user message, whichever came last".
        turnFiles = []
        turnFileIdx = new Map()
        break
      }
      case "cloned_from":
      case "forked_from": {
        const payload = event.payload as
          | {
              parentSessionId?: string
              parentTitle?: string
              parentEntryId?: string
            }
          | undefined
        const variant = event.kind === "forked_from" ? "fork" : "clone"
        out.push({
          role: "clone_marker",
          variant,
          parentSessionId: payload?.parentSessionId ?? null,
          parentTitle: payload?.parentTitle ?? null,
          parentEntryId: payload?.parentEntryId ?? null,
          timestamp: event.timestamp,
          key: `${variant}-${event.seq}`,
        })
        break
      }
      default:
        break
    }
  }

  // Trailing in-flight assistant message: render directly from the
  // last `partial` we saw. We walk the full ordered content list,
  // skipping `toolCall` blocks (those surface as tool cards via
  // `tool_execution_start` once pi actually invokes them, which
  // happens after `message_end`).
  if (openAssistantPartial) {
    const blocks = openAssistantPartial.content
    // Find the index of the last text / thinking block so we can
    // mark only the trailing one as actively streaming.
    let lastStreamableIdx = -1
    for (let i = blocks.length - 1; i >= 0; i--) {
      const b = blocks[i]
      if (b.type === "text" || b.type === "thinking") {
        lastStreamableIdx = i
        break
      }
    }
    const startSeq = openAssistantStartSeq ?? "open"
    for (let j = 0; j < blocks.length; j++) {
      const block = blocks[j]
      if (block.type === "text" && block.text) {
        out.push({
          role: "assistant",
          content: block.text,
          key: `assistant-streaming-${startSeq}-${j}`,
        })
      } else if (block.type === "thinking" && block.thinking) {
        out.push({
          role: "thinking",
          content: block.thinking,
          // Only the *trailing* block is "still streaming" (renders
          // expanded). Earlier thinking blocks that have already been
          // closed by a subsequent text/thinking block in `partial`
          // are effectively done and should collapse.
          streaming: j === lastStreamableIdx,
          key: `thinking-streaming-${startSeq}-${j}`,
        })
      }
    }
  }

  return coalesceThinking(out)
}

/**
 * Merge runs of consecutive `thinking` messages into a single block. The
 * model often emits multiple thinking content blocks back-to-back, and
 * rendering each as its own collapsed "Thought" pill is just noise \u2014 they
 * read as one continuous thought.
 */
function coalesceThinking(
  messages: MaterializedMessage[],
): MaterializedMessage[] {
  const out: MaterializedMessage[] = []
  for (const m of messages) {
    const prev = out[out.length - 1]
    if (
      m.role === "thinking" &&
      prev &&
      prev.role === "thinking" &&
      !!prev.streaming === !!m.streaming
    ) {
      out[out.length - 1] = {
        ...prev,
        content: prev.content + "\n\n" + m.content,
      }
    } else {
      out.push(m)
    }
  }
  return out
}

function inferToolKind(name: string | undefined): string {
  const n = (name ?? "").toLowerCase()
  if (n === "bash") return "execute"
  if (n === "edit") return "edit"
  if (n === "write") return "create"
  if (n === "read") return "read"
  if (n === "grep" || n === "find" || n === "ls" || n === "glob") return "search"
  if (n === "agent" || n === "task") return "think"
  return "other"
}

function summarizeArgs(args: unknown): string | undefined {
  if (args == null) return undefined
  try {
    const s = JSON.stringify(args)
    return s.length > 120 ? s.slice(0, 120) + "…" : s
  } catch {
    return undefined
  }
}

/**
 * Pull stdout / stderr out of an opaque tool result. The pi SDK puts
 * bash output in `content` (an array of text blocks) and also exposes
 * `stdout` / `stderr` on some result shapes — try both, fail soft.
 */
function extractToolResponse(
  toolName: string | undefined,
  result: unknown,
): ToolResponse | null {
  if (!result || typeof result !== "object") return null
  const r = result as Record<string, unknown>
  const stdout = pickString(r, ["stdout"])
  const stderr = pickString(r, ["stderr"])
  if (stdout != null || stderr != null) {
    return { stdout: stdout ?? undefined, stderr: stderr ?? undefined }
  }
  const content = Array.isArray(r.content) ? (r.content as unknown[]) : null
  if (content) {
    const text = content
      .map(c =>
        c && typeof c === "object" && "text" in c
          ? String((c as Record<string, unknown>).text ?? "")
          : "",
      )
      .filter(Boolean)
      .join("\n")
    if (text)
      return toolName === "bash" || toolName === "execute"
        ? { stdout: text }
        : { stdout: text }
  }
  return null
}

/**
 * Pull `{ type: "diff", path, oldText, newText }` items out of an edit
 * tool result when the underlying SDK stamped them onto `details.diff`
 * (unified diff). For everything else this returns an empty list.
 */
function extractContentItems(
  toolName: string | undefined,
  input: unknown,
  output: unknown,
): ToolCallContentItem[] | undefined {
  const n = (toolName ?? "").toLowerCase()
  if (n !== "edit") return undefined
  if (!output || typeof output !== "object") return undefined
  const r = output as Record<string, unknown>
  const details = r.details as Record<string, unknown> | undefined
  const diff = typeof details?.diff === "string" ? details.diff : undefined
  if (!diff) return undefined
  const inp = (input ?? {}) as Record<string, unknown>
  const path =
    pickString(inp, ["file_path", "path", "filePath"]) ?? "(unknown path)"
  const { oldText, newText } = splitUnifiedDiff(diff)
  return [{ type: "diff", path, oldText, newText }]
}

function pickString(
  obj: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === "string") return v
  }
  return null
}

/**
 * Classify a tool as a file-modifying op, returning the user-facing
 * kind for the summary card or `null` if it doesn't modify a file.
 * `write` creates (or overwrites) a file from scratch; `edit`
 * applies a patch to an existing one. `bash` is intentionally
 * excluded — it can also touch files but pi's event log doesn't
 * tell us which ones, so we'd end up with empty cards or false
 * negatives.
 */
function editOpKind(
  name: string | undefined,
): "create" | "edit" | null {
  const n = (name ?? "").toLowerCase()
  if (n === "write") return "create"
  if (n === "edit") return "edit"
  return null
}

/** Mirror of WriteCard's lineCount: the `write` tool body lives in
 * `content` (some SDK variants spell it `contents`). Empty payload
 * → 0, matching the inline card so the badge stays hidden in that
 * edge case. */
function lineCountOfWriteArgs(args: unknown): number {
  if (!args || typeof args !== "object") return 0
  const a = args as Record<string, unknown>
  const content = typeof a.content === "string" ? a.content : a.contents
  if (typeof content !== "string" || content.length === 0) return 0
  return content.split("\n").length
}

/** Mirror of countDiffLines + splitUnifiedDiff from tool-call-card.
 * Pulls the unified diff out of `result.details.diff` (same place
 * EditCard reads it), then tallies unique additions / removals by
 * line so a pure reformat doesn't double-count. Returns zeroes
 * when the SDK didn't stamp a diff onto the result. */
function editDiffStatsFromResult(
  result: unknown,
): { additions: number; removals: number } {
  if (!result || typeof result !== "object") return { additions: 0, removals: 0 }
  const r = result as Record<string, unknown>
  const details = r.details as Record<string, unknown> | undefined
  const diff = typeof details?.diff === "string" ? details.diff : undefined
  if (!diff) return { additions: 0, removals: 0 }
  const { oldText, newText } = splitUnifiedDiff(diff)
  const oldLines = oldText ? oldText.split("\n") : []
  const newLines = newText ? newText.split("\n") : []
  const oldSet = new Set(oldLines)
  const newSet = new Set(newLines)
  let additions = 0
  let removals = 0
  for (const line of newLines) if (!oldSet.has(line)) additions++
  for (const line of oldLines) if (!newSet.has(line)) removals++
  return { additions, removals }
}

function pickEditPath(args: unknown): string | null {
  if (!args || typeof args !== "object") return null
  return pickString(args as Record<string, unknown>, [
    "file_path",
    "path",
    "filePath",
  ])
}

/**
 * Edit tool args usually carry an absolute path (claude-code
 * convention), but git status / the diff viewer want
 * worktree-relative paths. If the path lives inside `directory`,
 * strip the prefix; otherwise leave it as-is so we don't fabricate
 * a relative path that points nowhere.
 */
function normalizeEditPath(
  filePath: string,
  directory: string | null,
): string {
  if (!directory) return filePath
  const dir = directory.endsWith("/") ? directory.slice(0, -1) : directory
  if (filePath === dir) return filePath
  const prefix = dir + "/"
  if (filePath.startsWith(prefix)) return filePath.slice(prefix.length)
  return filePath
}

function splitUnifiedDiff(diff: string): {
  oldText: string
  newText: string
} {
  const oldLines: string[] = []
  const newLines: string[] = []
  for (const line of diff.split("\n")) {
    if (line.startsWith("---") || line.startsWith("+++")) continue
    if (line.startsWith("@@")) continue
    if (line.startsWith("-")) oldLines.push(line.slice(1))
    else if (line.startsWith("+")) newLines.push(line.slice(1))
    else if (line.startsWith(" ")) {
      oldLines.push(line.slice(1))
      newLines.push(line.slice(1))
    }
  }
  return { oldText: oldLines.join("\n"), newText: newLines.join("\n") }
}
