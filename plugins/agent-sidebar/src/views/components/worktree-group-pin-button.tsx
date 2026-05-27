import { cn } from "@/lib/utils"
import { PinIcon } from "./icons"

/** Pin/unpin button for the right edge of a worktree-group row.
 * Always mounted in the same x position so toggling state doesn't
 * shift the row layout. Pinned → full opacity. Unpinned → hidden
 * at rest, fades in on row hover. */
export function WorktreeGroupPinButton({
  pinned,
  onToggle,
}: {
  pinned: boolean
  onToggle: () => void
}) {
  const label = pinned ? "Unpin worktree" : "Pin worktree"
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pinned}
      onClick={e => {
        e.stopPropagation()
        onToggle()
      }}
      onMouseDown={e => e.stopPropagation()}
      className={cn(
        "flex h-[20px] w-[20px] items-center justify-center rounded text-muted-foreground transition-opacity hover:bg-foreground/10 hover:text-foreground",
        pinned
          ? "opacity-100"
          : // `pointer-events-none` while hidden so the invisible
            // button doesn't intercept row clicks.
            "opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto",
      )}
    >
      <PinIcon filled={pinned} />
    </button>
  )
}
