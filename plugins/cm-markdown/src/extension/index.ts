/**
 * Default export is the CodeMirror `Extension` the cm-markdown
 * plugin registers under `meta.kind = "cm.composer-extension"`. The
 * framework's renderer-side reconciler dynamic-imports this module
 * and pushes the export into the in-renderer function registry; the
 * composer reads the registry and merges it into its compartment.
 */

import type { Extension } from "@codemirror/state"
import { markdownDecorations, markdownTheme } from "./markdown-field"

const extension: Extension = [markdownDecorations, markdownTheme]

export default extension

// Named exports for other CodeMirror surfaces that want the bare
// decorations / theme (e.g. a standalone MarkdownEditor that doesn't
// go through the function registry seam).
export { markdownDecorations, markdownTheme } from "./markdown-field"
