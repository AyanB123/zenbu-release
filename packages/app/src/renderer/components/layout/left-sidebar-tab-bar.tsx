import { cn } from "@/lib/utils"
import type { LeftSidebarTab } from "@/lib/window-state"

export type LeftSidebarTabBarProps = {
  active: LeftSidebarTab
  onSelect: (tab: LeftSidebarTab) => void
}

type TabDef = {
  id: LeftSidebarTab
  label: string
  icon: React.ReactNode
}

const TABS: TabDef[] = [
  { id: "agent", label: "Agents", icon: <AgentIcon /> },
  { id: "pi-sessions", label: "Pi Sessions", icon: <PiSessionsIcon /> },
]

export function LeftSidebarTabBar({ active, onSelect }: LeftSidebarTabBarProps) {
  return (
    <div
      // 35px total = `ChatTabs` h-9 (36px) minus the 1px `border-t`
      // the surrounding `<Sidebar>` already draws for us. With our
      // own `border-b`, the bottom rule lands at the same y as the
      // per-tab inset shadow on the right pane's tab strip, so the
      // crease reads as one continuous line across the TitleBar
      // seam.
      //
      // `-mx-1.5 px-1.5` neutralises the `px-1.5` the
      // `<Sidebar header>` wrapper adds so our `border-b` spans the
      // sidebar's full inner width (otherwise the rule would inset
      // 6px on each side and look broken next to the chat strip's
      // full-width bottom rule).
      className="flex h-[35px] shrink-0 -mx-1.5 px-1.5 items-center justify-center gap-1 border-b"
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
    >
      {TABS.map(tab => {
        const isActive = tab.id === active
        return (
          <button
            key={tab.id}
            type="button"
            aria-label={tab.label}
            onClick={() => onSelect(tab.id)}
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded",
              isActive
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
            )}
          >
            {tab.icon}
          </button>
        )
      })}
    </div>
  )
}

function AgentIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  )
}

function PiSessionsIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 3v18" />
      <path d="M5 7h6a3 3 0 0 1 3 3v0" />
      <path d="M5 14h8a3 3 0 0 1 3 3v0" />
      <circle cx="18" cy="10" r="2" />
      <circle cx="19" cy="17" r="2" />
    </svg>
  )
}
