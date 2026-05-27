import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export type PaneFrameAdjacency = {
  /** Something sits flush above (e.g. a tab strip, the window title
   * bar). When true the top edge is the neighbor's job; we don't
   * draw `border-t`. */
  topAdjacent?: boolean
  /** Something sits flush below (e.g. the bottom panel / terminal). */
  bottomAdjacent?: boolean
  /** Something sits flush to the left (e.g. the agent sidebar or
   * workspace rail with its own right border). */
  leftAdjacent?: boolean
  /** Something sits flush to the right (e.g. an open right
   * sidebar). */
  rightAdjacent?: boolean
}

export type PaneFrameProps = PaneFrameAdjacency & {
  /** Extra classes merged after the structural + border classes so
   * the consumer can override (e.g. `absolute inset-0`). */
  className?: string
  children: ReactNode
}

/**
 * The chrome a pane draws around its content.
 *
 * Three places in the app render "a pane-shaped area with chat-style
 * borders":
 *
 *  1. `ChatPane` — a chat tab inside the workspace pane system.
 *  2. `TabPanel` (chat-pane-container) — a view tab inside the same
 *     pane system.
 *  3. The workspace-less global-view branch in `agent-sidebar-pane`
 *     (e.g. Settings opened from onboarding).
 *
 * All three follow the same rule: draw a 1px border on every side
 * that doesn't already have a neighbor drawing the line. Before this
 * component, each site spelt that out inline with its own ternary
 * soup, and missing one — e.g. the View tab not drawing `border-t`
 * when the tab strip was hidden in single-tab mode — left a visibly
 * missing seam against the title bar. Centralizing the rule here
 * means every pane shape stays in sync as we add new pane consumers.
 *
 * The component is intentionally just a styled `<div>`: no Allotment,
 * no scroll container, no tab strip. Consumers stack those inside.
 */
export function PaneFrame({
  topAdjacent = false,
  bottomAdjacent = false,
  leftAdjacent = false,
  rightAdjacent = false,
  className,
  children,
}: PaneFrameProps) {
  return (
    <div
      className={cn(
        "relative flex h-full min-h-0 min-w-0 flex-col bg-background",
        !topAdjacent && "border-t",
        !bottomAdjacent && "border-b",
        !leftAdjacent && "border-l",
        !rightAdjacent && "border-r",
        className,
      )}
    >
      {children}
    </div>
  )
}
