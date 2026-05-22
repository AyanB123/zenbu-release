import { Button } from "@/components/ui/button"
import { Spinner } from "../common/spinner"
import { WorkspaceIcon } from "./workspace-icon"
import { useWorkspaceIconUrl } from "@/lib/workspace-icon"
import type { Schema } from "../../../main/schema"

export type WorkspaceRailItemProps = {
  label: string
  icon?: Schema["workspaces"][string]["icon"]
  isActive: boolean
  hasActivity?: boolean
  onSelect: () => void
  onContextMenu?: (e: React.MouseEvent) => void
  title?: string
}

export function WorkspaceRailItem({
  label,
  icon,
  isActive,
  hasActivity = false,
  onSelect,
  onContextMenu,
  title,
}: WorkspaceRailItemProps) {
  const iconUrl = useWorkspaceIconUrl(icon ?? null)
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onSelect}
      onContextMenu={onContextMenu}
      aria-label={title ?? label}
      className="relative h-9 w-9 p-0 hover:bg-transparent"
      style={{
        borderRadius: 8,
        background: isActive ? "var(--card)" : "transparent",
        boxShadow: isActive ? "0 1px 2px rgba(0, 0, 0, 0.06)" : "none",
      }}
    >
      <span
        aria-hidden
        className="absolute"
        style={{
          left: -6,
          top: 6,
          bottom: 6,
          width: 3,
          borderRadius: 2,
          background: isActive ? "var(--foreground)" : "transparent",
        }}
      />
      <WorkspaceIcon src={iconUrl} fallback={label} isActive={isActive} />
      {hasActivity && !isActive && (
        <span
          aria-hidden
          className="absolute text-muted-foreground"
          style={{ right: 2, top: 2 }}
        >
          <Spinner />
        </span>
      )}
    </Button>
  )
}
