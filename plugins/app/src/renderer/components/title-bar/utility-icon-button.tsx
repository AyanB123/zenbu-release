import type { ReactNode } from "react"
import { Button } from "@zenbu/ui/button"
import { HoverTip } from "@zenbu/ui/hover-tip"
import { cn } from "@/lib/utils"

export type UtilityIconButtonProps = {
  children: ReactNode
  title: string
  onClick: () => void
  /** Render the button as "currently active" — same `var(--card)`
   * chip + soft shadow the workspace-rail items use when their
   * workspace is the active view. Used by the rail's Settings
   * button to light up when the global settings view is open. */
  active?: boolean
}

export function UtilityIconButton({
  children,
  title,
  onClick,
  active = false,
}: UtilityIconButtonProps) {
  return (
    <HoverTip label={title} setAriaLabel={false}>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        onClick={onClick}
        aria-label={title}
        className={cn(
          "hg-icon size-[22px] rounded text-muted-foreground hover:bg-transparent",
          active
            ? "bg-[var(--card)] text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.06)]"
            : "bg-transparent",
        )}
      >
        {children}
      </Button>
    </HoverTip>
  )
}
