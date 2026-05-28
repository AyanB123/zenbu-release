import { useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { useHasTrafficLights } from "@/lib/window-state/has-traffic-lights"

export const TITLE_BAR_HEIGHT = 30
export const TITLE_BAR_PADDING_LEFT = 78
/** No traffic lights in fullscreen / outside Electron. */
export const TITLE_BAR_PADDING_LEFT_NO_LIGHTS = 8

/** Minimum horizontal gap between the left/right regions and the
 * absolutely-centered label before we treat the label as overlapping
 * and hide it. */
const TITLE_BAR_CENTER_MIN_GAP = 8

export type TitleBarProps = {
  label?: string
  left?: ReactNode
  right?: ReactNode
  center?: ReactNode
}

export function TitleBar({ label, left, right, center }: TitleBarProps) {
  const hasTrafficLights = useHasTrafficLights()

  // The center slot is absolutely positioned (so the workspace name
  // stays geometrically centered regardless of left/right widths),
  // which means it can collide with the left or right regions when
  // those grow wide — e.g. when a plugin contributes a new title-bar
  // button that pushes the right slot leftward into the label.
  //
  // We solve this by measuring the three regions on every layout
  // change with `ResizeObserver` and fading the center slot out
  // when its rect would overlap one of the sides. The element is
  // kept in the DOM (opacity 0) so its own bounding rect remains
  // observable for the next recompute. If the user later resizes
  // the window or collapses a side region the label fades back in.
  const leftRef = useRef<HTMLDivElement>(null)
  const centerRef = useRef<HTMLDivElement>(null)
  const rightRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [centerVisible, setCenterVisible] = useState(true)

  useLayoutEffect(() => {
    const recompute = () => {
      const c = centerRef.current?.getBoundingClientRect()
      if (!c || c.width === 0) {
        // Center is empty / unmounted; nothing to fade.
        setCenterVisible(true)
        return
      }
      const l = leftRef.current?.getBoundingClientRect()
      const r = rightRef.current?.getBoundingClientRect()
      const overlapsLeft =
        !!l && l.right + TITLE_BAR_CENTER_MIN_GAP > c.left
      const overlapsRight =
        !!r && r.left - TITLE_BAR_CENTER_MIN_GAP < c.right
      setCenterVisible(!overlapsLeft && !overlapsRight)
    }
    recompute()
    const ro = new ResizeObserver(recompute)
    if (containerRef.current) ro.observe(containerRef.current)
    if (leftRef.current) ro.observe(leftRef.current)
    if (rightRef.current) ro.observe(rightRef.current)
    if (centerRef.current) ro.observe(centerRef.current)
    return () => ro.disconnect()
  }, [center, label, left, right])

  return (
    <div
      ref={containerRef}
      // Title bar matches `bg-sidebar` so it reads as a single
      // contiguous surface with the workspace rail / sidebar panels
      // below it. Border-t lines on those panels still show against
      // their own `bg-sidebar` background.
      className="shrink-0 relative flex items-center bg-sidebar text-muted-foreground text-[13px]"
      style={{
        height: TITLE_BAR_HEIGHT,
        paddingLeft: hasTrafficLights
          ? TITLE_BAR_PADDING_LEFT
          : TITLE_BAR_PADDING_LEFT_NO_LIGHTS,
        paddingRight: 8,
        WebkitAppRegion: "drag",
      } as React.CSSProperties}
    >
      <div
        ref={leftRef}
        className="relative flex items-center gap-0.5"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        {left}
      </div>
      <div
        ref={centerRef}
        className="pointer-events-none absolute inset-0 flex items-center justify-center"
        aria-label={label}
        aria-hidden={!centerVisible || undefined}
        style={{
          opacity: centerVisible ? 1 : 0,
          // Short fade so resize gestures don't flash. The label
          // either has room or it doesn't — in between is brief.
          transition: "opacity 120ms ease",
        }}
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
        ref={rightRef}
        className="relative ml-auto flex items-center gap-1.5"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        {right}
      </div>
    </div>
  )
}
