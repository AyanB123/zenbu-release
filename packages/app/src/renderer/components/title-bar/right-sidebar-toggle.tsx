import { UtilityIconButton } from "./utility-icon-button"

export type RightSidebarToggleProps = {
  open: boolean
  onToggle: () => void
}

/** Mirror of {@link SidebarToggle} for the right side — same icon
 * with the filled "active" stripe drawn on the right edge instead of
 * the left. Lives in the title bar's `right` slot so it's symmetrical
 * with the left toggle. */
export function RightSidebarToggle({ open, onToggle }: RightSidebarToggleProps) {
  return (
    <UtilityIconButton
      title={open ? "Hide right sidebar" : "Show right sidebar"}
      onClick={onToggle}
    >
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <line x1="15" y1="3" x2="15" y2="21" />
        {open && (
          <rect
            x="15"
            y="3"
            width="6"
            height="18"
            fill="currentColor"
            fillOpacity="0.15"
            stroke="none"
          />
        )}
      </svg>
    </UtilityIconButton>
  )
}
