/**
 * Yank http(s) URLs out of a freeform text blob (typically stdout
 * from a play-button run). We can't just use a fat regex because
 * URLs in terminal output sit next to all kinds of garbage: ANSI
 * escapes, trailing punctuation, parens, quotes, surrounding
 * markdown / code-fence stuff. We do a tight `https?://` scan,
 * then walk forwards letter-by-letter to find the longest plausible
 * URL boundary, then validate with the WHATWG `URL` constructor
 * (which is the only "is this thing actually parseable" check
 * worth trusting).
 *
 * Tests live in `parse-urls.test.ts`.
 */
export type ParsedUrl = {
  /** Cleaned URL string (passes `new URL()`). */
  href: string
  /** Byte offset in the input where this URL starts. Useful if the
   * caller wants to render the URL inline rather than only in a
   * footer. */
  start: number
  /** Exclusive end offset in the input. */
  end: number
}

const SCHEME_SOURCE = "\\bhttps?:\\/\\/"
function freshSchemeRe(): RegExp {
  return new RegExp(SCHEME_SOURCE, "gi")
}

// Characters that may appear unescaped *inside* a URL. We use this
// (rather than RFC 3986 reserved set logic) because users paste real
// URLs that go past the spec in practice — query strings with
// `[]`, `,`, etc. all turn up. We trim trailing punctuation
// separately below.
const URL_BODY_RE = /[^\s\u0000-\u001f\u007f<>"`{}|\\^]/

// Trailing punctuation we strip after extracting the candidate. The
// common case is a URL at the end of a sentence ("see http://x.y.")
// or inside parens, brackets, or quotes.
const TRAIL_PUNCT = new Set([".", ",", ";", ":", "!", "?"])
const PAIRS: Array<[string, string]> = [
  ["(", ")"],
  ["[", "]"],
  ["{", "}"],
  ["<", ">"],
  ['"', '"'],
  ["'", "'"],
  ["`", "`"],
]

/**
 * Strip ANSI CSI / OSC escape sequences from a buffer. Terminal
 * output is full of them and they confuse URL matching ("\x1b[0m"
 * jammed against a port number, OSC 8 hyperlinks with their own
 * URL inside the escape, etc.). We keep this conservative — only
 * the common forms — and leave any unrecognised escape alone so
 * we don't accidentally eat real content.
 */
export function stripAnsi(input: string): string {
  // CSI: ESC [ ... letter
  // OSC: ESC ] ... (BEL | ESC \)
  return input
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
}

/**
 * Extract every http/https URL from `input`. Returns them in order
 * of appearance. Duplicates are kept — callers that want a uniq'd
 * list can `Array.from(new Set(...))` over `href`.
 */
export function parseUrls(input: string): ParsedUrl[] {
  if (!input) return []
  const cleaned = stripAnsi(input)
  return parseUrlsClean(cleaned)
}

function parseUrlsClean(input: string): ParsedUrl[] {
  const out: ParsedUrl[] = []
  const re = freshSchemeRe()
  let m: RegExpExecArray | null
  while ((m = re.exec(input)) !== null) {
    const start = m.index
    let end = start + m[0].length
    while (end < input.length && URL_BODY_RE.test(input[end]!)) {
      end++
    }
    // Trim trailing punctuation / paired wrappers.
    while (end > start + m[0].length) {
      const ch = input[end - 1]!
      if (TRAIL_PUNCT.has(ch)) {
        end--
        continue
      }
      // Drop a trailing close-bracket if the matching open isn't in
      // the candidate (sentence-style "(see http://x)" wraps).
      const pair = PAIRS.find(([, close]) => close === ch)
      if (pair) {
        const candidate = input.slice(start, end)
        const opens = (candidate.match(escapeChar(pair[0])) ?? []).length
        const closes = (candidate.match(escapeChar(pair[1])) ?? []).length
        if (closes > opens) {
          end--
          continue
        }
      }
      break
    }
    if (end <= start + m[0].length) continue // bare "http://"
    const href = input.slice(start, end)
    if (isParseable(href)) {
      out.push({ href, start, end })
    }
  }
  return out
}

/**
 * Async variant that yields to the event loop every `chunkSize`
 * scheme matches. Use this when calling sites might be staring at
 * megabytes of streamed stdout — the sync variant is fine for the
 * normal case (the renderer caps the visible log at a few hundred
 * KB). The yield uses `setTimeout(0)` so the call slots behind
 * any pending paint, keeping the UI responsive.
 */
export async function parseUrlsAsync(
  input: string,
  options: { chunkSize?: number } = {},
): Promise<ParsedUrl[]> {
  if (!input) return []
  const chunkSize = options.chunkSize ?? 256
  const cleaned = stripAnsi(input)
  const out: ParsedUrl[] = []
  const re = freshSchemeRe()
  let matchesSinceYield = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(cleaned)) !== null) {
    const start = m.index
    let end = start + m[0].length
    while (end < cleaned.length && URL_BODY_RE.test(cleaned[end]!)) {
      end++
    }
    while (end > start + m[0].length) {
      const ch = cleaned[end - 1]!
      if (TRAIL_PUNCT.has(ch)) {
        end--
        continue
      }
      const pair = PAIRS.find(([, close]) => close === ch)
      if (pair) {
        const candidate = cleaned.slice(start, end)
        const opens = (candidate.match(escapeChar(pair[0])) ?? []).length
        const closes = (candidate.match(escapeChar(pair[1])) ?? []).length
        if (closes > opens) {
          end--
          continue
        }
      }
      break
    }
    if (end > start + m[0].length) {
      const href = cleaned.slice(start, end)
      if (isParseable(href)) out.push({ href, start, end })
    }
    matchesSinceYield++
    if (matchesSinceYield >= chunkSize) {
      matchesSinceYield = 0
      await yieldToEventLoop()
    }
  }
  return out
}

function yieldToEventLoop(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

function escapeChar(ch: string): RegExp {
  return new RegExp(ch.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&"), "g")
}

function isParseable(href: string): boolean {
  try {
    const u = new URL(href)
    // We only surface http(s) — file:// / javascript: / data: are
    // either out of scope or actively unsafe to surface as a "click
    // to open" link.
    return u.protocol === "http:" || u.protocol === "https:"
  } catch {
    return false
  }
}
