import type { ReactNode } from "react"

export const STATUS_BAR_HEIGHT = 22

export type StatusBarProps = {
  left?: ReactNode
  right?: ReactNode
}

export function StatusBar({ left, right }: StatusBarProps) {
  return (
    <div
      className="flex shrink-0 items-stretch border-t text-muted-foreground text-[11px]"
      style={{
        height: STATUS_BAR_HEIGHT,
        WebkitAppRegion: "no-drag",
      } as React.CSSProperties}
    >
      <div className="flex items-stretch">{left}</div>
      <div className="ml-auto flex items-stretch">{right}</div>
    </div>
  )
}
