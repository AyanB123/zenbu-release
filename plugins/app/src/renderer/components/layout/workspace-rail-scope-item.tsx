import { Button } from "@zenbu/ui/button"
import { cn } from "@/lib/utils"

export type WorkspaceRailScopeItemProps = {
  label: string
  /** Short character shown in the bubble (typically first letter of label). */
  glyph: string
  isActive: boolean
  /** Pending = a worktree row that has no materialized scope yet. We dim
   * the bubble so the user can tell it'll spawn a new scope on click. */
  isPending?: boolean
  onSelect: () => void
  onContextMenu?: (e: React.MouseEvent) => void
  title?: string
}

/** Smaller-than-workspace bubble shown in the rail beneath the active
 * workspace icon when the chats sidebar is collapsed. Mirrors the active
 * stripe pattern from `WorkspaceRailItem` at a smaller scale so the user
 * recognises the same selection language. */
export function WorkspaceRailScopeItem({
  label,
  glyph,
  isActive,
  isPending = false,
  onSelect,
  onContextMenu,
  title,
}: WorkspaceRailScopeItemProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onSelect}
      onContextMenu={onContextMenu}
      aria-label={title ?? label}
      className={cn(
        "relative h-7 w-7 p-0 text-[10px] font-medium uppercase hover:bg-transparent",
        isPending && !isActive
          ? "text-muted-foreground/60"
          : "text-muted-foreground",
      )}
      style={{
        borderRadius: 6,
        background: isActive ? "var(--card)" : "transparent",
        boxShadow: isActive ? "0 1px 2px rgba(0, 0, 0, 0.06)" : "none",
      }}
    >
      <span
        aria-hidden
        className="absolute"
        style={{
          left: -6,
          top: 5,
          bottom: 5,
          width: 2,
          borderRadius: 2,
          background: isActive ? "var(--foreground)" : "transparent",
        }}
      />
      <span className={cn(isActive && "text-foreground")}>{glyph}</span>
    </Button>
  )
}
