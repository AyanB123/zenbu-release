import type { ReactNode } from "react"

export const SIDEBAR_FOOTER_HEIGHT = 44
export const SIDEBAR_FOOTER_FADE = 24

export type SidebarFooterProps = {
  children?: ReactNode
}

/**
 * Fades the bottom of the sidebar list into the sidebar bg so scrolled
 * rows visually dissolve under the footer slot. The fade uses two
 * `--sidebar` stops (transparent → solid) so it themes correctly.
 */
export function SidebarFooter({ children }: SidebarFooterProps) {
  return (
    <div
      className="pointer-events-none absolute bottom-0 left-0 right-0"
      style={{ height: SIDEBAR_FOOTER_HEIGHT + SIDEBAR_FOOTER_FADE }}
    >
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background: `linear-gradient(
            to bottom,
            color-mix(in srgb, var(--sidebar) 0%, transparent) 0%,
            color-mix(in srgb, var(--sidebar) 85%, transparent) ${SIDEBAR_FOOTER_FADE}px,
            var(--sidebar) ${SIDEBAR_FOOTER_FADE + 4}px,
            var(--sidebar) 100%
          )`,
        }}
      />
      <div
        className="absolute bottom-0 left-0 right-0 flex items-end p-2"
        style={{
          height: SIDEBAR_FOOTER_HEIGHT,
          pointerEvents: "auto",
          WebkitAppRegion: "no-drag",
        } as React.CSSProperties}
      >
        {children}
      </div>
    </div>
  )
}
