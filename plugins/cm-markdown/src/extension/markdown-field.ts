import { Decoration, EditorView } from "@codemirror/view"
import { scanMarkdown, selectionTouchesSpan, type MdKind } from "./markdown-scan"

/**
 * Obsidian-style live preview for inline markdown.
 *
 * Two layers of decoration per recognised span:
 *
 *   1. A `mark` over the inner text that applies the rendered look
 *      (bold weight, italic slant, monospace bg, etc). This is always
 *      present so the formatting is visible whether the caret is in
 *      the span or not.
 *
 *   2. A `replace` (no widget) over each marker run (`**`, `*`, `` ` ``,
 *      `~~`). This hides the markers from view. The `replace` is only
 *      added when the selection is NOT touching the span, so clicking
 *      or arrowing into the span reveals the raw source like Obsidian.
 *
 * Like pills, the rendering is fully derived from `(doc, selection)`.
 * No side state, no parallel field — undo/redo and external edits all
 * Just Work.
 */

const styleClass: Record<MdKind, string> = {
  bold: "cm-md-bold",
  italic: "cm-md-italic",
  code: "cm-md-code",
  strike: "cm-md-strike",
  h1: "cm-md-h1",
  h2: "cm-md-h2",
  h3: "cm-md-h3",
  h4: "cm-md-h4",
  h5: "cm-md-h5",
  h6: "cm-md-h6",
}

export const markdownDecorations = EditorView.decorations.compute(
  ["doc", "selection"],
  state => {
    const sel = state.selection.main
    const spans = scanMarkdown(state.doc.toString())
    const items: { from: number; to: number; deco: Decoration }[] = []
    for (const s of spans) {
      if (selectionTouchesSpan(sel, s)) continue
      const innerFrom = s.openTo
      const innerTo = s.closeFrom
      if (innerFrom < innerTo) {
        items.push({
          from: innerFrom,
          to: innerTo,
          deco: Decoration.mark({ class: styleClass[s.kind] }),
        })
      }
      if (s.openFrom < s.openTo) {
        items.push({
          from: s.openFrom,
          to: s.openTo,
          deco: Decoration.replace({}),
        })
      }
      if (s.closeFrom < s.closeTo) {
        items.push({
          from: s.closeFrom,
          to: s.closeTo,
          deco: Decoration.replace({}),
        })
      }
    }
    items.sort((a, b) => a.from - b.from || a.to - b.to)
    return Decoration.set(
      items.map(i => i.deco.range(i.from, i.to)),
      true,
    )
  },
)

export const markdownTheme = EditorView.theme({
  ".cm-md-bold": { fontWeight: "600" },
  ".cm-md-italic": { fontStyle: "italic" },
  ".cm-md-strike": { textDecoration: "line-through" },
  ".cm-md-code": {
    fontFamily:
      "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    fontSize: "0.92em",
    padding: "0 4px",
    borderRadius: "4px",
    backgroundColor: "var(--muted, rgba(127,127,127,0.18))",
  },
  ".cm-md-h1": { fontSize: "1.6em", fontWeight: "700", lineHeight: "1.2" },
  ".cm-md-h2": { fontSize: "1.4em", fontWeight: "700", lineHeight: "1.2" },
  ".cm-md-h3": { fontSize: "1.2em", fontWeight: "700", lineHeight: "1.25" },
  ".cm-md-h4": { fontSize: "1.08em", fontWeight: "700" },
  ".cm-md-h5": { fontSize: "1em", fontWeight: "700" },
  ".cm-md-h6": { fontSize: "1em", fontWeight: "700", opacity: "0.8" },
})
