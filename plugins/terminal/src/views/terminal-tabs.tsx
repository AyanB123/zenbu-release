import type { ReactNode } from "react"
import { useRpc } from "@zenbujs/core/react"
import { cn } from "@zenbu/ui/utils"
import { HoverTip } from "@zenbu/ui/hover-tip"

export type TerminalTabEntry = {
  id: string
  title: string
}

export type TerminalTabsProps = {
  entries: TerminalTabEntry[]
  activeId: string | null
  onSelect: (id: string) => void
  onClose: (id: string) => void
  /** Spawn a new terminal in the current scope. */
  onCreate: () => void
  /** Clear the *active* terminal — both the renderer scrollback and
   * the underlying shell's prompt redraw. No-op when there is no
   * active terminal. */
  onClearActive: () => void
  /** Close the active terminal. Surfaced in the header `⋯` menu so
   * the active tab can be dismissed without hover-targeting the
   * trash icon on the row. */
  onCloseActive: () => void
  /** Kept on the public API for callers, but the bottom corner is always
   * flush against the outer app shell now — it owns the bottom-right
   * curve. */
  rightAdjacent?: boolean
}

/** VS Code-style vertical tab list on the right edge of the terminal
 * panel. Closely mirrors VS Code's Terminal-view tab UX: a flush
 * column on `bg-background` (matches the adjacent bottom-panel
 * icon strip so the two sidebars read as one surface), a compact
 * header at the top with
 * `[+]` (new terminal) and `[⋯]` (panel actions), then compact rows
 * (small text, small glyph, tight padding). The active row promotes
 * to `bg-sidebar-accent` — the same active-row token the agent
 * sidebar uses, so both side strips share a design language.
 *
 * The `[⋯]` button opens a native OS context menu (via
 * `rpc.app.contextMenu.show`) instead of a renderer popover, so it
 * picks up system styling and dodges floating-element layering
 * weirdness inside the iframe.
 *
 * Rows are label-only — no leading glyph. The whole column already
 * lives inside the terminal panel, so the rows don't need a
 * per-row "this is a shell" marker; dropping it gives the title
 * the full row width and matches the cleaner look. */
export function TerminalTabs({
  entries,
  activeId,
  onSelect,
  onClose,
  onCreate,
  onClearActive,
  onCloseActive,
  rightAdjacent = false,
}: TerminalTabsProps) {
  void rightAdjacent
  const hasActive = activeId != null
  return (
    <div
      className="flex h-full w-full flex-col overflow-hidden border-b bg-background"
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
    >
      <TabsHeader
        onCreate={onCreate}
        onClearActive={onClearActive}
        onCloseActive={onCloseActive}
        hasActive={hasActive}
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto border-b border-border/50">
        {entries.map((entry, index) => (
          <TerminalTabRow
            key={entry.id}
            title={entry.title}
            isActive={entry.id === activeId}
            isFirst={index === 0}
            onSelect={() => onSelect(entry.id)}
            onClose={() => onClose(entry.id)}
          />
        ))}
      </div>
    </div>
  )
}

/** Header strip at the top of the tab column. Two controls:
 *
 *  - `+` (left): spawn a new terminal in the current scope.
 *  - `⋯` (right): panel-level actions — clear active, close
 *    active. Disabled rendering when no terminal is active.
 *
 * Visually matches VS Code's Terminal-view header: a compact
 * `border-b` strip that sits flush with the tab list below.
 */
function TabsHeader({
  onCreate,
  onClearActive,
  onCloseActive,
  hasActive,
}: {
  onCreate: () => void
  onClearActive: () => void
  onCloseActive: () => void
  hasActive: boolean
}) {
  return (
    <div className="flex h-7 shrink-0 items-center justify-between border-b border-border/50 px-1.5">
      <HeaderIconButton
        ariaLabel="New terminal"
        title="New Terminal"
        onClick={onCreate}
      >
        <PlusIcon />
      </HeaderIconButton>
      <PanelActionsMenu
        onClearActive={onClearActive}
        onCloseActive={onCloseActive}
        hasActive={hasActive}
      />
    </div>
  )
}

function PanelActionsMenu({
  onClearActive,
  onCloseActive,
  hasActive,
}: {
  onClearActive: () => void
  onCloseActive: () => void
  hasActive: boolean
}) {
  const rpc = useRpc()
  // Show the OS-native context menu via `rpc.app.contextMenu.show`
  // (Electron's `Menu.popup()` under the hood) anchored at the
  // button's bottom-left corner. Native menus get system-correct
  // styling, keyboard navigation, and accessibility for free, and
  // avoid the floating-element layering issues a renderer-side
  // popover would hit inside an iframe.
  const handleClick = async (e: React.MouseEvent<HTMLButtonElement>) => {
    const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect()
    const { chosenId } = await rpc.app.contextMenu.show({
      x: Math.round(rect.left),
      y: Math.round(rect.bottom),
      items: [
        {
          id: "clear",
          label: "Clear",
          sublabel: "⌘K",
          enabled: hasActive,
        },
        { type: "separator" },
        {
          id: "kill",
          label: "Kill Terminal",
          enabled: hasActive,
        },
      ],
    })
    if (chosenId === "clear") onClearActive()
    else if (chosenId === "kill") onCloseActive()
  }
  return (
    <HoverTip label="More actions" setAriaLabel={false}>
      <button
        type="button"
        onClick={e => {
          void handleClick(e)
        }}
        aria-label="Terminal actions"
        className="grid size-[18px] place-items-center rounded-[3px] text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
      >
        <EllipsisIcon />
      </button>
    </HoverTip>
  )
}

function HeaderIconButton({
  ariaLabel,
  title,
  onClick,
  children,
}: {
  ariaLabel: string
  title: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <HoverTip label={title} setAriaLabel={false}>
      <button
        type="button"
        onClick={onClick}
        aria-label={ariaLabel}
        className="grid size-[18px] place-items-center rounded-[3px] text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
      >
        {children}
      </button>
    </HoverTip>
  )
}

function TerminalTabRow({
  title,
  isActive,
  isFirst,
  onSelect,
  onClose,
}: {
  title: string
  isActive: boolean
  isFirst: boolean
  onSelect: () => void
  onClose: () => void
}) {
  const display = stripShellPrefix(title)
  // Active row gets a top + bottom hairline so the selection
  // reads as a discrete "card" inset into the tab column. We use
  // `inset` box-shadows instead of real borders so the active
  // row's box model matches inactive rows exactly — a real
  // `border-b` would add 1px of height to whichever row is
  // currently active, which made every row below it shift down
  // one pixel on each selection change.
  void isFirst
  return (
    <div
      onClick={onSelect}
      className={cn(
        // Compact row: matches VS Code's Terminal view (~22px tall,
        // 11px text, tight horizontal padding). Keep it fixed-height
        // so long active terminal titles truncate instead of creating
        // a two-line selected row.
        "group flex h-[22px] select-none items-center gap-[6px] px-2 py-[3px] text-[11px] leading-[1.25]",
        isActive
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-muted-foreground hover:bg-sidebar-accent/40 hover:text-foreground",
      )}
    >
      <span
        aria-label={title}
        className="min-w-0 flex-1 truncate text-left"
      >
        {display}
      </span>
      <button
        type="button"
        onClick={e => {
          e.stopPropagation()
          onClose()
        }}
        aria-label="Close terminal"
        className={cn(
          "grid size-[14px] place-items-center text-muted-foreground hover:text-destructive",
          // Hover-only on every row, active or not. The active row's
          // selection state is already conveyed by the row background,
          // and a persistent trash glyph there reads as noise. The
          // `⋯` header menu's "Kill Terminal" entry is the
          // keyboard/menu path for dismissing the active tab without
          // pointer hover.
          "opacity-0 group-hover:opacity-100",
        )}
      >
        <TrashIcon />
      </button>
    </div>
  )
}

/** Many shells set the terminal title to `user@host: cwd` (bash default)
 * or `user@host — cwd` (zsh/macOS). The host prefix burns most of the
 * available width in a narrow tab list and tells the user nothing about
 * which shell this is, so drop it when present. */
function stripShellPrefix(title: string): string {
  const m = title.match(/^[^\s@:]+@[^\s:]+\s*[:\u2014-]\s*(.+)$/)
  return m ? m[1] : title
}

function PlusIcon(): ReactNode {
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
      aria-hidden
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

function EllipsisIcon(): ReactNode {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      <circle cx="5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="19" cy="12" r="1.6" />
    </svg>
  )
}

function TrashIcon(): ReactNode {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
    </svg>
  )
}
