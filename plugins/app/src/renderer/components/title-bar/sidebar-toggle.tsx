import { UtilityIconButton } from "./utility-icon-button"

export type SidebarToggleProps = {
  open: boolean
  onToggle: () => void
}

export function SidebarToggle({ open, onToggle }: SidebarToggleProps) {
  return (
    <UtilityIconButton
      title={open ? "Hide sidebar" : "Show sidebar"}
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
        <line x1="9" y1="3" x2="9" y2="21" />
        {open && (
          <rect
            x="3"
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
