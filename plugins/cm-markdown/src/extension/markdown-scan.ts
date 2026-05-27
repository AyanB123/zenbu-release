/**
 * Scan a doc string for inline markdown spans we want to live-preview:
 * bold, italic, inline code, and strikethrough. The doc is the single
 * source of truth, and the markdown decoration computer just re-runs
 * this on every state change.
 *
 * Deliberately small. We're matching Obsidian's *inline* live preview
 * behaviour, not parsing a full Markdown document: no headings, no
 * lists, no links yet. Add them when the need is concrete.
 *
 * Overlap rule: spans are emitted in document order; once a span is
 * accepted, any later span that overlaps its inner-text range is
 * dropped. That keeps `**foo*bar*baz**` from double-decorating without
 * needing a real parser.
 */

export type MdKind =
  | "bold"
  | "italic"
  | "code"
  | "strike"
  | "h1"
  | "h2"
  | "h3"
  | "h4"
  | "h5"
  | "h6"

export type MdSpan = {
  kind: MdKind
  /** Outer range, including the marker characters. */
  from: number
  to: number
  /** Opening marker range, e.g. the two `*`s in `**bold**`. */
  openFrom: number
  openTo: number
  /** Closing marker range. */
  closeFrom: number
  closeTo: number
}

type Rule = {
  kind: MdKind
  /** Capture group 1 must be the inner text. */
  re: RegExp
  markerLen: number
}

// Order matters: bold (`**`) before italic (`*`) so `**x**` isn't
// scanned as `*` + `*x*` + `*`. Within a single pass we still try
// every rule, then resolve overlaps below.
const RULES: Rule[] = [
  { kind: "bold", re: /\*\*(?=\S)([^\n*]+?)(?<=\S)\*\*/g, markerLen: 2 },
  { kind: "strike", re: /~~(?=\S)([^\n~]+?)(?<=\S)~~/g, markerLen: 2 },
  {
    kind: "italic",
    re: /(?<![*\w])\*(?=\S)([^\n*]+?)(?<=\S)\*(?![*\w])/g,
    markerLen: 1,
  },
  { kind: "code", re: /`([^\n`]+?)`/g, markerLen: 1 },
]

const HEADING_RE = /^(#{1,6}) (.+)$/gm

function scanHeadings(docText: string): MdSpan[] {
  const out: MdSpan[] = []
  for (const m of docText.matchAll(HEADING_RE)) {
    const from = m.index ?? -1
    if (from < 0) continue
    const level = m[1]!.length
    const markerLen = level + 1
    const to = from + m[0].length
    out.push({
      kind: `h${level}` as MdKind,
      from,
      to,
      openFrom: from,
      openTo: from + markerLen,
      closeFrom: to,
      closeTo: to,
    })
  }
  return out
}

export function scanMarkdown(docText: string): MdSpan[] {
  const raw: MdSpan[] = []
  for (const rule of RULES) {
    for (const m of docText.matchAll(rule.re)) {
      const from = m.index ?? -1
      if (from < 0) continue
      const to = from + m[0].length
      raw.push({
        kind: rule.kind,
        from,
        to,
        openFrom: from,
        openTo: from + rule.markerLen,
        closeFrom: to - rule.markerLen,
        closeTo: to,
      })
    }
  }
  raw.sort((a, b) => a.from - b.from || b.to - a.to)

  const inline: MdSpan[] = []
  let lastInnerEnd = -1
  for (const s of raw) {
    const innerFrom = s.openTo
    if (innerFrom < lastInnerEnd) continue
    inline.push(s)
    lastInnerEnd = s.closeFrom
  }
  return [...scanHeadings(docText), ...inline]
}

export function selectionTouchesSpan(
  sel: { from: number; to: number },
  span: Pick<MdSpan, "from" | "to">,
): boolean {
  return sel.from <= span.to && sel.to >= span.from
}
