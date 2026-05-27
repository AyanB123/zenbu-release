import { cn } from "@/lib/utils"

// Native grid bounding box: 3 columns × 18px spacing + 9px dot = 45px wide,
// 4 rows × 9px spacing + 9px dot = 36px tall. We render the loader at native
// size and use `transform: scale()` so it stays crisp at any requested size.
const NATIVE_W = 45
const NATIVE_H = 36

// 4×3 grid. Position of each dot in native pixels: (col * 18, row * 9).
// Keyed by `${row}${col}` so the CSS can target per-dot animations.
const DOTS: ReadonlyArray<readonly [number, number]> = [
  [0, 0], [0, 1], [0, 2],
  [1, 0], [1, 1], [1, 2],
  [2, 0], [2, 1], [2, 2],
  [3, 0], [3, 1], [3, 2],
]

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
      className={cn(
        "hg-spinner relative inline-block align-middle",
        className,
      )}
      style={{
        width: size,
        height: Math.round(size * (NATIVE_H / NATIVE_W)),
      }}
    >
      <span
        className="hg-grid-loader"
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: NATIVE_W,
          height: NATIVE_H,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
        }}
      >
        {DOTS.map(([r, c]) => (
          <span
            key={`${r}${c}`}
            className="hg-grid-loader-dot"
            data-dot={`${r}${c}`}
            style={{ left: c * 18, top: r * 9 }}
          />
        ))}
      </span>
    </span>
  )
}
