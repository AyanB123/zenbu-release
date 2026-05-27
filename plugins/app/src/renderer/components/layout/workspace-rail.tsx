import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { Button } from "@zenbu/ui/button"
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@zenbu/ui/popover"
import { WorkspaceRailItem } from "./workspace-rail-item"
import { displayPath, useHomeDir } from "@/lib/home-dir"
import type { Schema } from "../../../main/schema"

export const RAIL_WIDTH = 48

export type WorkspaceRailEntry = {
  id: string
  label: string
  icon?: Schema["workspaces"][string]["icon"]
  /** Auto-derived icon (favicon-like file found in the workspace
   * directory). Resolved underneath `icon` by
   * `useWorkspaceIconUrl` — the user upload always wins. */
  iconAuto?: Schema["workspaces"][string]["iconAuto"]
  hasActivity?: boolean
  /** Absolute filesystem path shown in the rail's hover popover so
   * the user can disambiguate same-named workspaces at a glance.
   * Derived in `useWorkspaceRailEntries` from the workspace's
   * primary repo's `mainWorktreePath`, falling back to the
   * earliest scope's `directory`. Null when the workspace has no
   * scopes yet (fresh, empty workspace). */
  path?: string | null
}

export type WorkspaceRailProps = {
  workspaces: WorkspaceRailEntry[]
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

/**
 * Hover state for the rail's shared popover. We track the hovered
 * entry's data + a snapshot of its bounding rect (used to position
 * an invisible `<PopoverAnchor>` that follows whichever item is
 * under the cursor). One popover, one mount — moving between items
 * just repositions Floating UI instead of remounting per-item
 * tooltips (which is what caused the fade-in/fade-out flicker even
 * with `skipDelayDuration`).
 */
type HoverState = {
  id: string
  label: string
  path: string | null
  rect: { top: number; left: number; width: number; height: number }
}

const HOVER_CLOSE_DELAY_MS = 80

export function WorkspaceRail({
  workspaces,
  activeId,
  onSelect,
  onAdd,
  addActive = false,
  onContextMenu,
  onBackgroundContextMenu,
  footer,
}: WorkspaceRailProps) {
  const homeDir = useHomeDir()
  const [hover, setHover] = useState<HoverState | null>(null)
  // Snapshot of the most recently shown hover. We render the
  // popover's *content* from this — not from `hover` — so that
  // when `hover` flips to `null` on hover-leave the label/path
  // don't disappear before the popover itself has finished
  // closing. Otherwise you get a one-frame flash where the
  // `PopoverContent` is still in the DOM (Radix Presence keeps it
  // mounted for any exit animation, and even without one there's
  // a render where the conditional `{hover && …}` has become
  // empty) but has no children — looking like a tiny blank
  // tooltip square next to the rail.
  const [displayedHover, setDisplayedHover] = useState<HoverState | null>(null)
  useEffect(() => {
    if (hover) setDisplayedHover(hover)
  }, [hover])
  const closeTimerRef = useRef<number | null>(null)
  const anchorRef = useRef<HTMLDivElement>(null)

  const cancelClose = useCallback(() => {
    if (closeTimerRef.current != null) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }, [])

  const scheduleClose = useCallback(() => {
    cancelClose()
    closeTimerRef.current = window.setTimeout(() => {
      setHover(null)
      closeTimerRef.current = null
    }, HOVER_CLOSE_DELAY_MS)
  }, [cancelClose])

  // Reposition the invisible anchor in `useLayoutEffect` so Floating
  // UI sees the updated rect before paint — no one-frame flash at
  // the previous position.
  useLayoutEffect(() => {
    const el = anchorRef.current
    if (!el || !hover) return
    el.style.top = `${hover.rect.top}px`
    el.style.left = `${hover.rect.left}px`
    el.style.width = `${hover.rect.width}px`
    el.style.height = `${hover.rect.height}px`
  }, [hover])

  const handleHoverEnter = useCallback(
    (entry: WorkspaceRailEntry, el: HTMLElement) => {
      cancelClose()
      const r = el.getBoundingClientRect()
      setHover({
        id: entry.id,
        label: entry.label,
        path: entry.path ?? null,
        rect: { top: r.top, left: r.left, width: r.width, height: r.height },
      })
    },
    [cancelClose],
  )

  const renderItem = (ws: WorkspaceRailEntry) => {
    const isActive = ws.id === activeId
    return (
      <WorkspaceRailItem
        key={ws.id}
        label={ws.label}
        icon={ws.icon ?? null}
        iconAuto={ws.iconAuto ?? null}
        isActive={isActive}
        hasActivity={ws.hasActivity}
        onSelect={() => onSelect(ws.id)}
        onHoverEnter={el => handleHoverEnter(ws, el)}
        onHoverLeave={scheduleClose}
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
  const shownPath = displayedHover?.path
    ? displayPath(displayedHover.path, homeDir)
    : null
  return (
    <Popover open={hover != null}>
      <div
        // The rail and the agent sidebar to its right are one visual
        // surface (`bg-sidebar`) below the title bar. `border-t` draws
        // the seam against the bar — no `bg-clip-padding` here so the
        // border sits over `bg-sidebar` (the element's own bg),
        // matching the rendering of every other border in the app
        // instead of the darker parent (`bg-muted`).
        className="flex shrink-0 flex-col items-center gap-1 overflow-y-auto border-t bg-sidebar text-muted-foreground py-2"
        style={
          {
            width: RAIL_WIDTH,
            WebkitAppRegion: "no-drag",
          } as React.CSSProperties
        }
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
        {footer && (
          <div className="flex flex-col items-center gap-1">{footer}</div>
        )}
      </div>
      {/* Invisible anchor div — `fixed`-positioned to match the
       *  currently-hovered rail item's bounding rect. Floating UI
       *  reads from this to place `PopoverContent` to its side. As
       *  long as `hover` stays non-null while scrubbing between
       *  items, the Popover never closes — Floating UI just
       *  recomputes the position, so there's no remount, no
       *  open/close animation, no flicker. */}
      <PopoverAnchor asChild>
        <div
          ref={anchorRef}
          aria-hidden
          style={{ position: "fixed", pointerEvents: "none" }}
        />
      </PopoverAnchor>
      <PopoverContent
        side="right"
        align="center"
        sideOffset={6}
        // Disable the open/close animations on the shared popover.
        // The whole point of lifting this to a single instance is
        // that it stays mounted across item transitions — animating
        // would re-introduce the flicker we just designed out. The
        // first appearance / last disappearance also feel snappier
        // without the fade.
        style={{ animation: "none" }}
        className="w-auto max-w-sm px-3 py-2"
        onMouseEnter={cancelClose}
        onMouseLeave={scheduleClose}
        // Don't yank focus off the rail item the user is
        // hovering — popover is purely informational.
        onOpenAutoFocus={e => e.preventDefault()}
        onCloseAutoFocus={e => e.preventDefault()}
      >
        {displayedHover && (
          <div className="flex flex-col gap-0.5 text-left">
            <div className="text-sm font-medium leading-tight">
              {displayedHover.label}
            </div>
            {shownPath && (
              <div className="font-mono text-xs leading-tight text-muted-foreground break-all">
                {shownPath}
              </div>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
