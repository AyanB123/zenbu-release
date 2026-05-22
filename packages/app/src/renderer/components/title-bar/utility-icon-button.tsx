import type { ReactNode } from "react"
import { Button } from "@/components/ui/button"

export type UtilityIconButtonProps = {
  children: ReactNode
  title: string
  onClick: () => void
}

export function UtilityIconButton({
  children,
  title,
  onClick,
}: UtilityIconButtonProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      onClick={onClick}
      aria-label={title}
      className="hg-icon size-[22px] rounded bg-transparent text-muted-foreground hover:bg-transparent"
    >
      {children}
    </Button>
  )
}
