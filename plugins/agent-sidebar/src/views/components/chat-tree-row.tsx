import type { ReactNode } from "react"
import { cn } from "@/lib/utils"
import { SidebarRow } from "@/components/layout/sidebar-row"

export type ChatTreeRowProps = {
  label: string
  isActive: boolean
  isStreaming?: boolean
  /** When true, render an unread dot on the row. Forwarded to
   * {@link SidebarRow.hasUnread}. The dot only appears when the row
   * is NOT the active chat — callers usually compute this as
   * `session.lastCompletedAt > (session.lastOpenedAt ?? 0) && !isActive`. */
  hasUnread?: boolean
  /** When true, render a small pencil glyph on the row indicating
   * the chat has a saved composer draft. Forwarded to
   * {@link SidebarRow.hasDraft}. Callers should only set this when
   * the row is NOT the active chat — the editor itself is the
   * canonical surface when you're on the chat. */
  hasDraft?: boolean
  /** Render a shimmer placeholder instead of the label (e.g. while a title is being generated). */
  isGeneratingTitle?: boolean
  timestamp?: number | null
  expandable: boolean
  isExpanded: boolean
  onToggleExpand: () => void
  onClick: () => void
  onContextMenu?: (e: React.MouseEvent) => void
  /** Optional tree content rendered below the row when expanded. */
  treeContent?: ReactNode
  /** Hover-only action buttons rendered on the right edge of the row. */
  hoverActions?: ReactNode
}

export function ChatTreeRow({
  label,
  isActive,
  isStreaming,
  hasUnread,
  hasDraft,
  isGeneratingTitle,
  timestamp,
  expandable,
  isExpanded,
  onToggleExpand,
  onClick,
  onContextMenu,
  treeContent,
  hoverActions,
}: ChatTreeRowProps) {
  return (
    <div className="flex min-w-0 flex-col">
      <div className="relative flex min-w-0 items-stretch">
        {expandable && (
          <button
            type="button"
            onClick={e => {
              e.stopPropagation()
              onToggleExpand()
            }}
            className="absolute left-0 top-0 z-10 flex h-[30px] w-5 items-center justify-center text-muted-foreground hover:text-foreground"
            aria-label={isExpanded ? "Collapse" : "Expand"}
          >
            <Chevron open={isExpanded} />
          </button>
        )}
        <div className={cn("min-w-0 flex-1", expandable && "pl-3")}>
          <SidebarRow
            label={label}
            isActive={isActive}
            isStreaming={isStreaming}
            hasUnread={hasUnread}
            hasDraft={hasDraft}
            isGeneratingTitle={isGeneratingTitle}
            timestamp={timestamp}
            onClick={onClick}
            onContextMenu={onContextMenu}
            hoverActions={hoverActions}
          />
        </div>
      </div>
      {isExpanded && treeContent && (
        <div className="pl-3 pr-1 pb-1">{treeContent}</div>
      )}
    </div>
  )
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{
        transform: open ? "rotate(90deg)" : "rotate(0deg)",
        transition: "transform 120ms ease",
      }}
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
}
