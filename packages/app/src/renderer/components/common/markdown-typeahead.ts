import type { ReactNode } from "react"
import type { EditorState } from "@codemirror/state"

export type TriggerMatch = {
  char: string
  query: string
  /** Doc position of the trigger character. */
  from: number
  /** Doc position just past the query (cursor). */
  to: number
}

/**
 * Detect a single-character typeahead trigger immediately before the
 * cursor (e.g. `@octo` or `#42`). Generalised from the composer's
 * `detectTrigger` so it can power any MarkdownEditor with arbitrary
 * trigger chars.
 *
 * A trigger only activates when the character before it is
 * start-of-line or whitespace — same rule the composer uses, matching
 * the social-media muscle memory people already have.
 */
/**
 * Per-trigger options that affect how `detectTrigger` decides whether
 * to match. Keyed by the trigger character.
 */
export type TriggerOptions = Record<
  string,
  {
    /** When true, the trigger only matches if the *preceding*
     * character is whitespace (not start-of-line). Useful for `#`
     * in Markdown: `# Heading` at column 0 shouldn't open an
     * issue typeahead, but `Fixes #123` mid-line should. Defaults
     * to false (start-of-line OR whitespace both match, like `@`). */
    requireWhitespaceBefore?: boolean
  }
>

export function detectTrigger(
  state: EditorState,
  chars: readonly string[],
  options: TriggerOptions = {},
): TriggerMatch | null {
  if (chars.length === 0) return null
  const sel = state.selection.main
  if (!sel.empty) return null
  const head = sel.head
  const line = state.doc.lineAt(head)
  const before = state.doc.sliceString(line.from, head)

  for (let i = before.length - 1; i >= 0; i--) {
    const ch = before[i]
    if (chars.includes(ch)) {
      const prev = i === 0 ? "" : before[i - 1]
      const opts = options[ch]
      const startOfLineOk = !opts?.requireWhitespaceBefore
      if (prev === "") {
        if (!startOfLineOk) return null
      } else if (!/\s/.test(prev)) {
        return null
      }
      const query = before.slice(i + 1)
      // Whitespace inside the query terminates the trigger — a user
      // typing "@robby hey" should drop out of mention mode after the
      // space.
      if (/\s/.test(query)) return null
      return { char: ch, query, from: line.from + i, to: head }
    }
    if (/\s/.test(ch)) return null
  }
  return null
}

/**
 * Configuration for a single typeahead trigger fed into MarkdownEditor.
 *
 * Each trigger is owned by the caller, which gives full control over
 * how to fetch results (RPC, in-memory, async) and how to render each
 * row. The editor handles caret tracking, keyboard navigation,
 * insertion, and the empty-state message.
 */
export type TypeaheadItem = {
  /** Stable key for React + selection tracking. */
  key: string
  /** Plain-text label used for screen readers; ranking is the
   *  caller's job inside `fetch`. */
  label: string
  /** Doc text inserted in place of the trigger run. Should include
   *  the trigger char if you want it to survive (e.g. `"@octocat"`,
   *  `"#42"`) and usually ends with a trailing space. */
  insertText: string
  /** How to render the row in the popup. */
  display: ReactNode
}

export type TypeaheadTrigger = {
  /** Single character that activates this trigger (e.g. `"@"`). */
  char: string
  /** When true, the trigger only matches if a whitespace character
   *  precedes it — i.e. not at the very start of a line. Useful for
   *  `#`, which doubles as the Markdown heading marker and shouldn't
   *  open an issue typeahead when the user is typing `# Heading`. */
  requireWhitespaceBefore?: boolean
  /**
   * Resolve candidates for `query` (text typed after the trigger char).
   *
   * Return `[]` to show `emptyLabel` in the menu. Throw / reject to
   * also show `emptyLabel` — the editor treats errors as "no results"
   * rather than crashing the popup. Surface real errors elsewhere
   * (e.g. a toast or an inline ErrorBanner in the calling view) if
   * you want them visible.
   *
   * Called on every keystroke under the trigger, so cache as needed.
   * The editor coalesces concurrent invocations: when a new call
   * starts, the in-flight one's result is discarded.
   */
  fetch: (query: string) => Promise<TypeaheadItem[]>
  /** Shown in the menu when `fetch` returns an empty array. Required —
   *  the menu *always* renders for an active trigger, even when empty,
   *  so "no matches" is informative instead of mysterious silence. */
  emptyLabel: string
}
