import Anser from "anser"

export type AnsiLineProps = {
  text: string
}

/**
 * Renders a single line of text containing ANSI escape sequences as
 * styled spans. We map foreground colors to theme-friendly Tailwind
 * classes so the output reads correctly in both light and dark mode
 * instead of using anser's hard-coded RGB values.
 */
export function AnsiLine({ text }: AnsiLineProps) {
  const segments = Anser.ansiToJson(text, { use_classes: false })
  return (
    <>
      {segments.map((seg, i) => {
        const className = classFor(seg)
        return (
          <span key={i} className={className || undefined}>
            {seg.content}
          </span>
        )
      })}
    </>
  )
}

function classFor(seg: {
  fg?: string
  decoration?: string | null
}): string {
  const dim = seg.decoration === "dim" || seg.decoration === "faint"
  switch (seg.fg) {
    case "187,0,0":
    case "255,85,85":
      return "text-red-500"
    case "0,187,0":
    case "85,255,85":
      return "text-emerald-500"
    case "187,187,0":
    case "255,255,85":
      return "text-amber-500"
    case "0,0,187":
    case "85,85,255":
      return "text-blue-400"
    case "187,0,187":
    case "255,85,255":
      return "text-fuchsia-400"
    case "0,187,187":
    case "85,255,255":
      return "text-cyan-400"
    case "255,255,255":
    case "187,187,187":
      return "text-foreground"
    default:
      return dim ? "text-muted-foreground" : ""
  }
}
