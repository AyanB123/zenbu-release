import type { ReactNode } from "react"

export const TITLE_BAR_HEIGHT = 30
export const TITLE_BAR_PADDING_LEFT = 78

export type TitleBarProps = {
  label?: string
  left?: ReactNode
  right?: ReactNode
  center?: ReactNode
}

export function TitleBar({ label, left, right, center }: TitleBarProps) {
  return (
    <div
      // Title bar matches `bg-sidebar` so it reads as a single
      // contiguous surface with the workspace rail / sidebar panels
      // below it. Border-t lines on those panels still show against
      // their own `bg-sidebar` background.
      className="shrink-0 relative flex items-center bg-sidebar text-muted-foreground text-[13px]"
      style={{
        height: TITLE_BAR_HEIGHT,
        paddingLeft: TITLE_BAR_PADDING_LEFT,
        paddingRight: 8,
        WebkitAppRegion: "drag",
      } as React.CSSProperties}
    >
      <div
        className="relative flex items-center gap-0.5"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        {left}
      </div>
      <div
        className="pointer-events-none absolute inset-0 flex items-center justify-center"
        aria-label={label}
      >
        {center ? (
          <div className="flex max-w-[60%] items-center gap-2 px-2">
            {center}
          </div>
        ) : (
          <span className="max-w-[60%] truncate px-2 text-[12px] font-medium text-muted-foreground">
            {label}
          </span>
        )}
      </div>
      <div
        className="relative ml-auto flex items-center gap-0.5"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        {right}
      </div>
    </div>
  )
}
