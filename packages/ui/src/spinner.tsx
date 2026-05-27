import { cn } from "./utils"

// Native grid bounding box: 3 columns × 18px spacing + 9px dot = 45px wide,
// 4 rows × 9px = 36px tall. We render the loader at native size and use
// `transform: scale()` so it stays crisp at any requested size.
//
// Visual style is supplied by the host via the `.hg-grid-loader` CSS class
// (see the app's global stylesheet). Plugins importing this component
// inherit that class automatically when running inside the host.
const NATIVE_W = 45
const NATIVE_H = 36

export function Spinner({
  size = 12,
  className,
}: {
  size?: number
  className?: string
}) {
  const scale = size / NATIVE_W
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn("relative inline-block align-middle", className)}
      style={{
        width: size,
        height: Math.round(size * (NATIVE_H / NATIVE_W)),
      }}
    >
      <span
        className="hg-grid-loader"
        style={{
          position: "absolute",
          left: 18 * scale,
          top: 9 * scale,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
        }}
      />
    </span>
  )
}
