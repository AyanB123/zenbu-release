import type { ReactNode } from "react"

export type PaletteShellProps = {
  /** Optional header content rendered above the body (e.g. breadcrumb). */
  header?: ReactNode
  /** Optional footer rendered below the body (e.g. shortcut hints). */
  footer?: ReactNode
  children: ReactNode
}

/**
 * The visual chrome of the palette card — used by both the root command
 * list and every command's morphed view. Keeps width / shadow / border
 * consistent across modes.
 */
export function PaletteShell({ header, footer, children }: PaletteShellProps) {
  return (
    <div
      onClick={e => e.stopPropagation()}
      className="flex w-[560px] max-w-[90vw] flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl"
    >
      {header && (
        <div className="shrink-0 border-b border-border">{header}</div>
      )}
      <div className="min-h-0 flex-1">{children}</div>
      {footer && (
        <div className="shrink-0 border-t border-border bg-muted/70 px-3 py-2 text-[11px] text-muted-foreground">
          {footer}
        </div>
      )}
    </div>
  )
}
