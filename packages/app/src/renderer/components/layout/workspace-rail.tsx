import { Fragment, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { WorkspaceRailItem } from "./workspace-rail-item"
import type { Schema } from "../../../main/schema"

export const RAIL_WIDTH = 48

export type WorkspaceRailEntry = {
  id: string
  label: string
  icon?: Schema["workspaces"][string]["icon"]
  hasActivity?: boolean
}

export type WorkspaceRailProps = {
  workspaces: WorkspaceRailEntry[]
  /** Workspaces rendered in a fixed slot at the bottom of the rail,
   * directly above `footer`. These don't scroll with the main list
   * and don't compete with `onAdd` for the trailing slot — used for
   * the built-in self-edit ("sentinel") workspace, which has to be
   * findable in the same place every time the user looks for it. */
  pinnedBottomWorkspaces?: WorkspaceRailEntry[]
  activeId: string | null
  onSelect: (id: string) => void
  onAdd?: () => void
  /** When true, render the "+" button in its active state. Used to
   * mark the rail's add-button as the currently selected
   * "workspace" while the onboarding view is on screen — in that
   * mode no real workspace is active, but the "+" *is* what's
   * driving the center pane. */
  addActive?: boolean
  onContextMenu?: (id: string, e: React.MouseEvent) => void
  /** Right-click on the rail background (i.e. not on a workspace
   * item). Used to show a native "Hide" menu so the user can dismiss
   * the rail via right-click without the default Chromium menu
   * appearing. */
  onBackgroundContextMenu?: (e: React.MouseEvent) => void

  /** Buttons pinned to the bottom of the rail (e.g. settings). */
  footer?: ReactNode
}

export function WorkspaceRail({
  workspaces,
  pinnedBottomWorkspaces,
  activeId,
  onSelect,
  onAdd,
  addActive = false,
  onContextMenu,
  onBackgroundContextMenu,
  footer,
}: WorkspaceRailProps) {
  const renderItem = (ws: WorkspaceRailEntry) => {
    const isActive = ws.id === activeId
    return (
      <WorkspaceRailItem
        key={ws.id}
        label={ws.label}
        icon={ws.icon ?? null}
        isActive={isActive}
        hasActivity={ws.hasActivity}
        onSelect={() => onSelect(ws.id)}
        onContextMenu={
          onContextMenu
            ? e => {
                e.preventDefault()
                // Don't let this bubble to the rail-level
                // background handler — items have their own
                // workspace context menu.
                e.stopPropagation()
                onContextMenu(ws.id, e)
              }
            : undefined
        }
      />
    )
  }
  return (
    <div
      // The rail and the agent sidebar to its right are one visual
      // surface (`bg-sidebar`) below the title bar. `border-t` draws
      // the seam against the bar — no `bg-clip-padding` here so the
      // border sits over `bg-sidebar` (the element's own bg),
      // matching the rendering of every other border in the app
      // instead of the darker parent (`bg-muted`).
      className="flex shrink-0 flex-col items-center gap-1 overflow-y-auto border-t bg-sidebar text-muted-foreground py-2"
      style={{
        width: RAIL_WIDTH,
        WebkitAppRegion: "no-drag",
      } as React.CSSProperties}
      onContextMenu={
        onBackgroundContextMenu
          ? e => {
              // Item-level onContextMenu calls stopPropagation, so
              // this only fires when the user right-clicked the
              // rail background (or the +/footer area). Suppress
              // the default Chromium menu either way.
              e.preventDefault()
              onBackgroundContextMenu(e)
            }
          : undefined
      }
    >
      <div className="flex flex-1 flex-col items-center gap-1 w-full">
        {workspaces.map(ws => (
          <Fragment key={ws.id}>{renderItem(ws)}</Fragment>
        ))}
        {onAdd && (
          <div className="relative mt-1">
            {/* Left-edge accent bar, mirroring `WorkspaceRailItem`,
             *  so the "+" lights up the same way a selected
             *  workspace does while onboarding is the active view. */}
            <span
              aria-hidden
              className="absolute"
              style={{
                left: -6,
                top: 6,
                bottom: 6,
                width: 3,
                borderRadius: 2,
                background: addActive ? "var(--foreground)" : "transparent",
              }}
            />
            <Button
              type="button"
              variant="outline"
              onClick={onAdd}
              aria-label="New workspace"
              aria-pressed={addActive}
              className={
                "h-9 w-9 border-dashed p-0 " +
                (addActive
                  ? "text-foreground"
                  : "bg-transparent text-muted-foreground hover:text-foreground")
              }
              style={{
                borderRadius: 8,
                background: addActive ? "var(--card)" : undefined,
                boxShadow: addActive
                  ? "0 1px 2px rgba(0, 0, 0, 0.06)"
                  : undefined,
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </Button>
          </div>
        )}
      </div>
      {pinnedBottomWorkspaces && pinnedBottomWorkspaces.length > 0 && (
        <div className="flex flex-col items-center gap-1 w-full">
          {pinnedBottomWorkspaces.map(ws => (
            <Fragment key={ws.id}>{renderItem(ws)}</Fragment>
          ))}
        </div>
      )}
      {footer && (
        <div className="flex flex-col items-center gap-1">{footer}</div>
      )}
    </div>
  )
}
