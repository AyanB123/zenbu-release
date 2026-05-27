import { type ReactNode } from "react"
import { cn } from "@/lib/utils"
import { Spinner } from "@/components/common/spinner"

export type WorktreeGroupRowProps = {
  label: string
  collapsed: boolean
  onToggle: () => void
  onContextMenu?: (e: React.MouseEvent) => void
  /**
   * Whether any chat inside this group is currently streaming. When
   * the group is collapsed the spinner of the streaming child row is
   * hidden (the row itself is unmounted from the layout's perspective
   * — it isn't rendered), so we surface the activity on the group
   * header instead. When the group is expanded the spinner moves back
   * onto the child row, so we suppress it here to avoid showing it
   * twice.
   */
  isStreaming?: boolean
  /**
   * Whether any chat inside this group is the currently active chat.
   * When collapsed we paint the trigger with the active background
   * (`is-active`) so the user can still see where the active chat
   * lives even when its row isn't rendered. When the group is
   * expanded the active child row itself is `.is-active`, so we
   * suppress it here to avoid double-highlighting.
   */
  isActiveChildCollapsed?: boolean
  /**
   * Whether any chat inside this group has an unviewed/unread
   * indicator. Mirrors `isStreaming`: when the group is collapsed we
   * surface the dot on the trigger because the child row isn't
   * rendered; when expanded the child's own dot takes over.
   */
  hasUnread?: boolean
  /**
   * Action buttons that fade in on the right edge when the row is
   * hovered. Mirrors `SidebarRow`'s `hoverActions` prop so worktree
   * groups and chat rows feel identical \u2014 same gradient fade, same
   * background backdrop driven by `--hg-row-bg`.
   */
  hoverActions?: ReactNode
  /**
   * Render-prop for the pin indicator anchored to the row's right
   * edge. When the scope is pinned this button is always visible
   * (and clicking it unpins); when the scope is unpinned the
   * button stays mounted in the same x position but fades in only
   * on row hover so we get zero layout shift between the pinned
   * / unpinned / hovered states. Pass `null` to hide the slot
   * entirely (e.g. when there's only a single worktree and the
   * pin affordance doesn't add value).
   */
  pinSlot?: ReactNode
  /**
   * Whether the pin in `pinSlot` is actually anchored at rest (i.e.
   * the scope is currently pinned). The slot itself stays mounted
   * for both pinned and unpinned rows so the pin button can fade in
   * on hover without layout shift, but the static `rightIndicator`
   * should only reserve space to the LEFT of the pin when the pin
   * is visibly occupying that space at rest. Otherwise the
   * indicator looks oddly indented on rows whose pin is hidden.
   */
  pinned?: boolean
  /**
   * Static indicator anchored to the row's right edge. Mounted in
   * its own absolutely-positioned slot so it can sit alongside the
   * label without competing with the hover-actions slot for layout
   * space. Behaviour mirrors `pinSlot` in spirit — same fixed
   * right offset, same `group-hover` driven transition — but the
   * default is *inverted*: indicators are visible at rest and fade
   * OUT on row hover so the compose / more buttons can take over
   * that area cleanly. When `pinSlot` is also rendered the
   * indicator sits to its left (24px offset) so the two static
   * slots never overlap. Pass `null` to leave the slot empty.
   */
  rightIndicator?: ReactNode
  children?: ReactNode
}

/**
 * Sidebar row that groups chats belonging to the same worktree.
 * Click anywhere on the row toggles expand/collapse. Right-click
 * opens a context menu the parent owns.
 */
export function WorktreeGroupRow({
  label,
  collapsed,
  onToggle,
  onContextMenu,
  hoverActions,
  pinSlot,
  pinned = false,
  rightIndicator,
  isStreaming = false,
  isActiveChildCollapsed = false,
  hasUnread = false,
  children,
}: WorktreeGroupRowProps) {
  const showSpinner = isStreaming && collapsed
  // The active background and unread dot only apply when collapsed:
  // when expanded the child row owns those indicators.
  const showActive = isActiveChildCollapsed && collapsed
  // Unread dot is suppressed when a spinner is already visible — the
  // spinner conveys "something is happening here" and we don't want
  // to stack two indicators in the same slot (mirrors the rule in
  // `SidebarRow` for unread vs streaming).
  const showUnread = hasUnread && collapsed && !showSpinner
  return (
    // `mt-2` adds a small gap above each group so worktrees read as
    // distinct sections. The enclosing `<ListNav.Branch>` (in
    // `agent-sidebar-view.tsx`) carries the `mt-2 first:mt-0`
    // spacing now, since the branch wrapper sits between the
    // sidebar body container and this row. The very first group's
    // top margin is visually absorbed by the sidebar header's
    // padding above, so we don't need to suppress it explicitly.
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
          showActive && "is-active",
        )}
      >
        <span className="inline-flex size-3.5 shrink-0 items-center justify-center text-muted-foreground">
          <ChevronIcon open={!collapsed} />
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px]">{label}</span>
        {showSpinner && (
          // Only shown while collapsed — the child row's own spinner
          // is hidden because the row isn't mounted. Hidden on hover
          // so the action buttons (compose / more) can claim the
          // slot, matching how `SidebarRow` treats its spinner.
          //
          // When a `pinSlot` is rendered we nudge the spinner left
          // by the pin's footprint (20px button + 4px gap from the
          // row's right edge) so it sits to the LEFT of the pin
          // instead of underneath it. The pin is absolutely
          // positioned, so flex flow doesn't reserve space for it
          // on its own.
          <span
            aria-label="Activity in collapsed worktree"
            className="flex shrink-0 items-center text-muted-foreground group-hover:hidden"
            style={pinSlot ? { marginRight: 20 } : undefined}
          >
            <Spinner />
          </span>
        )}
        {showUnread && (
          // Surfaced on the trigger only while collapsed — the
          // unread child row isn't rendered, so without this the
          // user has no signal that an agent inside this group
          // finished a turn. Mirrors the spinner: hidden on hover
          // so the action buttons can claim the slot, and shifted
          // left by the pin's footprint when `pinSlot` is mounted
          // so it sits to the LEFT of the pin.
          <span
            aria-label="Unread chat in collapsed worktree"
            className="flex shrink-0 items-center group-hover:hidden"
            style={pinSlot ? { marginRight: 20 } : undefined}
          >
            <span className="block h-1.5 w-1.5 rounded-full bg-foreground" />
          </span>
        )}
        {/* Right-edge stack:
            - rightIndicator is visible at rest and fades OUT on
              hover, so it never collides visually with the hover
              actions stack. When pinSlot is also present it shifts
              left by 24px so the two static slots stack cleanly.
            - hover actions (compose / more) fade in on row hover,
              tucked to the LEFT of the pin slot via a gradient.
            - pin slot is always mounted at the same right offset so
              the pin icon never shifts between pinned, unpinned, and
              hovered states. Its inner visibility is controlled by
              the caller (see `WorktreeGroupPinButton` below). */}
        {rightIndicator && (
          <div
            className="pointer-events-none absolute inset-y-0 flex items-center text-muted-foreground opacity-100 transition-opacity duration-100 group-hover:opacity-0"
            // Only reserve space to the left of the pin when the
            // pin is visibly anchored at rest. An unpinned pin slot
            // is invisible until hover, and on hover the indicator
            // is fading out anyway, so squashing it right is safe.
            style={{ right: pinSlot && pinned ? "28px" : "6px" }}
            aria-hidden={false}
          >
            {rightIndicator}
          </div>
        )}
        {hoverActions && (
          <div
            className="pointer-events-none absolute inset-y-0 hidden items-center group-hover:flex"
            style={{ right: pinSlot ? "calc(0.25rem + 20px)" : "0" }}
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
              className="pointer-events-auto flex h-full items-center gap-0.5"
              style={{ background: "var(--hg-row-bg)" }}
            >
              {hoverActions}
            </div>
          </div>
        )}
        {pinSlot && (
          // The pin slot sits flush against the right edge of the
          // `hoverActions` backdrop (which ends at
          // `right: calc(0.25rem + 20px)` = 24px). Its own width is
          // exactly the 20px pin button + the 4px `right-1` offset,
          // so painting `--hg-row-bg` here tiles seamlessly with the
          // hover-actions strip — no overlap, no gap. `--hg-row-bg`
          // is `transparent` at rest, so the backdrop only appears
          // when the row is hovered / active and never masks content
          // when the pin is sitting on the row's natural background.
          <div
            className="absolute inset-y-0 right-1 flex items-center"
            style={{ background: "var(--hg-row-bg)" }}
          >
            {pinSlot}
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

