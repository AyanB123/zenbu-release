import type { ReactNode } from "react"
import { cn } from "@/lib/utils"
import { Spinner } from "../common/spinner"

export type SidebarRowProps = {
  label: string
  icon?: ReactNode
  isActive: boolean
  isStreaming?: boolean
  hasUnread?: boolean
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
