import type { ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export type SidebarHeaderRowProps = {
  icon: ReactNode
  label: string
  shortcut?: string
  isActive?: boolean
  onClick: () => void
}

export function SidebarHeaderRow({
  icon,
  label,
  shortcut,
  isActive = false,
  onClick,
}: SidebarHeaderRowProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onClick}
      className={cn(
        "hg-header flex h-auto min-h-[30px] w-full justify-start gap-2 rounded-md bg-transparent py-1.5 pl-1.5 pr-2 text-left font-normal text-sidebar-foreground hover:bg-transparent",
        isActive && "is-active",
      )}
    >
      <span className="inline-flex size-4 items-center justify-center text-muted-foreground">
        {icon}
      </span>
      <span className="flex-1 truncate text-[13px]">{label}</span>
      {shortcut && (
        <span className="text-[11px] text-muted-foreground">{shortcut}</span>
      )}
    </Button>
  )
}
