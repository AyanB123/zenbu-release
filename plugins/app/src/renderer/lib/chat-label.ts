import type { Schema } from "../../main/schema"

type Chat = Schema["chats"][string]
type Session = Schema["sessions"][string]

/**
 * Cheap label used for chat tab titles. Deliberately doesn't load AI
 * summaries — tab titles need to render at 60fps as the user splits /
 * closes / reorders tabs, and the `branchSummary` / `session.title`
 * path already covers most cases.
 *
 * Shared between the main app's pane container and the standalone
 * chat-window view so both surfaces show identical titles.
 */
export function chatLabel(
  chat: Chat,
  sessionsById: Record<string, Session | undefined>,
): string {
  if (chat.session.kind !== "ready") return "New Chat"
  const session = sessionsById[chat.session.sessionId]
  const summary = session?.branchSummary
  if (summary && summary.trim()) {
    return truncate(summary.trim(), 40)
  }
  const title = session?.title?.trim()
  if (title && title !== "Untitled") {
    return truncate(title, 40)
  }
  return "New Chat"
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "\u2026"
}

/**
 * Richer label resolver used by the sidebar where we additionally
 * have the per-session AI summary in flight. Precedence:
 *
 *   - AI summary text (when present in the db).
 *   - session.branchSummary.
 *   - session.title (unless still "Untitled").
 *   - else "New Chat".
 */
export function resolveChatLabel(
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

function truncateInline(s: string, n: number): string {
  const oneLine = s.replace(/\s+/g, " ")
  if (oneLine.length <= n) return oneLine
  return oneLine.slice(0, n - 1) + "\u2026"
}
