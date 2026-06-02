/**
 * Default export is the CodeMirror `Extension` the cm-markdown
 * plugin registers under `meta.kind = "cm.markdown-extension"`.
 */

import type { Extension } from "@codemirror/state"
import { markdownDecorations, markdownTheme } from "./markdown-field"

const extension: Extension = [markdownDecorations, markdownTheme]

export default extension
