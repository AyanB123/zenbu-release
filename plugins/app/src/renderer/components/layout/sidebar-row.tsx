import type { ReactNode } from "react"
import { cn } from "@/lib/utils"
import { Spinner } from "../common/spinner"

function DraftIcon() {
  // Lucide-style "pencil-line" glyph: a pencil sitting above a
  // baseline. Reads as "draft / not yet sent" at sidebar scale
  // (12px) without being mistaken for the compose action button
  // (which is the same family but bigger and lives in hoverActions).
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ pointerEvents: "none" }}
      aria-hidden="true"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  )
}

export type SidebarRowProps = {
  label: string
  icon?: ReactNode
  isActive: boolean
  isStreaming?: boolean
  hasUnread?: boolean
  /**
   * Renders a small pencil glyph on the right edge of the row when
   * the chat backing this row has a saved composer draft. Callers
   * usually compute this as `chatStates[chatId].draft` being
   * non-empty AND the row not being the active chat — we never
   * want to flag the row you're currently typing on, because the
   * editor itself is right there.
   *
   * Treated visually like {@link hasUnread}: hidden on hover so the
   * `hoverActions` slot can take over without overlap.
   */
  hasDraft?: boolean
  isGeneratingTitle?: boolean
  timestamp?: number | null
  onClick: () => void
  onClose?: () => void
  onContextMenu?: (e: React.MouseEvent) => void
  /**
   * Optional buttons that fade in on the right edge when the row is hovered.
   * Rendered over the label with a gradient mask so the underlying text
   * appears to fade out under the buttons instead of being clipped abruptly.
   */
  hoverActions?: ReactNode
}

export function SidebarRow({
  label,
  icon,
  isActive,
  isStreaming = false,
  hasUnread = false,
  hasDraft = false,
  isGeneratingTitle = false,
  timestamp,
  onClick,
  onClose,
  onContextMenu,
  hoverActions,
}: SidebarRowProps) {
  void timestamp

  return (
    <div
      onClick={onClick}
      onContextMenu={
        onContextMenu
          ? e => {
              e.preventDefault()
              onContextMenu(e)
            }
          : undefined
      }
      className={cn(
        "hg-row group relative mb-[1px] flex min-h-[30px] min-w-0 cursor-default select-none items-center gap-2 overflow-hidden rounded-md py-1.5 pl-1.5 pr-2 text-muted-foreground",
        isActive && "is-active",
      )}
    >
      {icon}
      {isGeneratingTitle ? (
        <span className="flex min-w-0 flex-1">
          <span className="shimmer-bar inline-block h-3 w-28 rounded-sm align-middle" />
        </span>
      ) : (
        <span className="min-w-0 flex-1 truncate">{label}</span>
      )}
      {hasUnread && !isStreaming && !hasDraft && (
        // Unread dot: the agent finished a turn while the user was
        // not viewing this chat. `SessionActivityService` keeps
        // `lastOpenedAt` in sync; the dot disappears the instant
        // the user focuses this chat. Suppressed while streaming
        // because the spinner already conveys "something is
        // happening here". Also suppressed when there's a draft —
        // the draft glyph is the more actionable cue (the user is
        // mid-thought on this chat), and we don't want to stack two
        // indicators in the same slot.
        <span
          aria-label="Unread"
          className="flex shrink-0 items-center group-hover:hidden"
        >
          <span className="block h-1.5 w-1.5 rounded-full bg-foreground" />
        </span>
      )}
      {hasDraft && !isStreaming && (
        // Draft glyph: this chat has a saved composer draft and is
        // not the chat currently in focus. Clicking the row
        // restores the draft and refocuses the composer (the
        // sidebar's `handleSelectChat` calls
        // `requestFocusComposer` when the destination row has a
        // draft), so the icon doubles as a passive indicator AND
        // the click target — same affordance as the unread dot, no
        // separate button needed. Hidden on hover so hoverActions
        // (open in new tab, archive, more) can claim the slot.
        // Suppressed while streaming for the same reason as the
        // unread dot.
        <span
          aria-label="Has draft"
          title="Unsent draft"
          className="flex shrink-0 items-center text-muted-foreground group-hover:hidden"
        >
          <DraftIcon />
        </span>
      )}
      {isStreaming && (
        <span className="flex shrink-0 items-center gap-1 group-hover:hidden">
          <Spinner />
        </span>
      )}
      {onClose && (
        <span
          onClick={e => {
            e.stopPropagation()
            onClose()
          }}
          className="hidden shrink-0 px-1 text-sm leading-none text-muted-foreground hover:text-foreground group-hover:inline"
          aria-label="Close"
        >
          ×
        </span>
      )}
      {hoverActions && (
        <div
          className="hg-row-hover-actions pointer-events-none absolute inset-y-0 right-0 hidden items-center group-hover:flex"
          aria-hidden={false}
        >
          {/* Gradient fade so the label appears to slide under the buttons. */}
          <div
            className="h-full w-6"
            style={{
              background:
                "linear-gradient(to right, transparent, var(--hg-row-bg))",
            }}
          />
          <div
            className="pointer-events-auto flex h-full items-center gap-0.5 pr-1"
            style={{ background: "var(--hg-row-bg)" }}
          >
            {hoverActions}
          </div>
        </div>
      )}
    </div>
  )
}
