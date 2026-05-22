import { type ReactNode } from "react"
import { cn } from "@/lib/utils"

export type WorktreeGroupRowProps = {
  label: string
  collapsed: boolean
  onToggle: () => void
  onContextMenu?: (e: React.MouseEvent) => void
  /**
   * Action buttons that fade in on the right edge when the row is
   * hovered. Mirrors `SidebarRow`'s `hoverActions` prop so worktree
   * groups and chat rows feel identical \u2014 same gradient fade, same
   * background backdrop driven by `--hg-row-bg`.
   */
  hoverActions?: ReactNode
  children?: ReactNode
}

/**
 * Sidebar row that groups chats belonging to the same worktree.
 * Click anywhere on the row toggles expand/collapse. Right-click
 * opens a context menu the parent owns. The git-branch icon
 * distinguishes these from regular folder rows so a worktree reads
 * as "a branch of work" rather than "a file location".
 */
export function WorktreeGroupRow({
  label,
  collapsed,
  onToggle,
  onContextMenu,
  hoverActions,
  children,
}: WorktreeGroupRowProps) {
  return (
    <div className="flex flex-col">
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={e => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            onToggle()
          }
        }}
        onContextMenu={
          onContextMenu
            ? e => {
                e.preventDefault()
                onContextMenu(e)
              }
            : undefined
        }
        className={cn(
          // `.hg-row` provides hover (`bg-accent`) and active
          // (`bg-sidebar-accent`) styles plus the `--hg-row-bg`
          // variable used by the hover-actions backdrop. Matches
          // the chat rows beneath so the group reads as part of
          // the same list, not a separate header.
          "hg-row group relative mb-[1px] flex min-h-[30px] min-w-0 cursor-default select-none items-center gap-1.5 overflow-hidden rounded-md py-1.5 pl-1.5 pr-2 text-sidebar-foreground",
        )}
      >
        <span className="inline-flex size-3.5 shrink-0 items-center justify-center text-muted-foreground">
          <ChevronIcon open={!collapsed} />
        </span>
        <span className="inline-flex size-3.5 shrink-0 items-center justify-center text-muted-foreground">
          <BranchIcon />
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px]">{label}</span>
        {hoverActions && (
          <div
            className="pointer-events-none absolute inset-y-0 right-0 hidden items-center group-hover:flex"
            aria-hidden={false}
          >
            {/* Gradient fade so the label appears to slide under
                the buttons. Mirrors `SidebarRow.hoverActions`. */}
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
      {!collapsed && children && (
        // Full-width rows + indented *content*. We leave the rows
        // edge-to-edge (so hover/active backgrounds paint to the
        // gutter, matching this header) and just bump the inner
        // `.hg-row` padding from `pl-1.5` (6px) to `pl-6` (24px),
        // pushing only the label and icons inward.
        <div className="flex flex-col gap-px [&_.hg-row]:!pl-6">
          {children}
        </div>
      )}
    </div>
  )
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
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

function BranchIcon() {
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
    >
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  )
}
