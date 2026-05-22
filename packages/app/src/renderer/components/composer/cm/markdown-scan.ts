/**
 * Scan a doc string for inline markdown spans we want to live-preview:
 * bold, italic, inline code, and strikethrough. Same shape and spirit
 * as `pill-scan.ts` — the doc is the single source of truth, and the
 * markdown decoration computer just re-runs this on every state change.
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
  // Bold: `**text**`. Inner can't start or end with `*` and can't
  // contain newlines. Non-greedy to keep adjacent runs separate.
  { kind: "bold", re: /\*\*(?=\S)([^\n*]+?)(?<=\S)\*\*/g, markerLen: 2 },
  // Strikethrough: `~~text~~`.
  { kind: "strike", re: /~~(?=\S)([^\n~]+?)(?<=\S)~~/g, markerLen: 2 },
  // Italic: `*text*`. Avoid eating into bold (`**`) by requiring the
  // surrounding chars to not be `*`. No word-char on either side keeps
  // `2*3*4` from italicising.
  {
    kind: "italic",
    re: /(?<![*\w])\*(?=\S)([^\n*]+?)(?<=\S)\*(?![*\w])/g,
    markerLen: 1,
  },
  // Inline code: `` `text` ``. Backticks are literal; no escaping.
  { kind: "code", re: /`([^\n`]+?)`/g, markerLen: 1 },
]

/**
 * Headings have no closing marker — the line break ends them — so
 * we model them with an empty closing range (`closeFrom === closeTo`).
 * Inline marks are still allowed to nest inside heading inner text;
 * the overlap-dedup logic below only applies to inline-vs-inline.
 */
const HEADING_RE = /^(#{1,6}) (.+)$/gm

function scanHeadings(docText: string): MdSpan[] {
  const out: MdSpan[] = []
  for (const m of docText.matchAll(HEADING_RE)) {
    const from = m.index ?? -1
    if (from < 0) continue
    const level = m[1]!.length
    // Marker is `#`*level followed by one space.
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

  // Drop later spans whose inner range overlaps an already-accepted
  // span's inner range. Outer-marker overlap is allowed so a bold
  // sitting flush against an italic still works.
  const inline: MdSpan[] = []
  let lastInnerEnd = -1
  for (const s of raw) {
    const innerFrom = s.openTo
    if (innerFrom < lastInnerEnd) continue
    inline.push(s)
    lastInnerEnd = s.closeFrom
  }
  // Headings sit alongside inline marks without participating in the
  // overlap dedup — a `### foo **bar**` line keeps both decorations.
  return [...scanHeadings(docText), ...inline]
}

/**
 * Same asymmetry as `selectionTouchesPill` — see notes there. We want
 * the markers to reveal as soon as the caret enters the span from
 * either side, but not when it's sitting just past the closing marker.
 */
export function selectionTouchesSpan(
  sel: { from: number; to: number },
  span: Pick<MdSpan, "from" | "to">,
): boolean {
  return sel.from <= span.to && sel.to >= span.from
}
