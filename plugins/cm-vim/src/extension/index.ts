/**
 * Vim CodeMirror extension. Combined:
 *
 *   - `vim()` from `@replit/codemirror-vim` — the actual modal editing.
 *   - A `ViewPlugin` that, on construction, grabs the CodeMirror-vim
 *     `CodeMirror` instance via `getCM(view)`, subscribes to
 *     `vim-mode-change`, and forwards the normalized mode to the
 *     plugin's singleton store. On destroy it detaches the listener
 *     and clears the store.
 *
 *   - A view-init effect that immediately enters insert mode the first
 *     time the extension mounts in a focused editor, matching the
 *     composer's previous "boot into insert" behavior. We trigger this
 *     from inside the ViewPlugin rather than from React because we
 *     don't have a React reference to the live view.
 *
 * Default-exported so the framework's function-registry reconciler can
 * import this module and push the value into the in-renderer registry.
 */

import { ViewPlugin, type EditorView } from "@codemirror/view"
import type { Extension } from "@codemirror/state"
import { getCM, vim, Vim } from "@replit/codemirror-vim"
import { setActiveVimMode, normalizeVimMode } from "../store"

type CMHandler = (e: { mode: string }) => void

function enterInsertMode(cm: ReturnType<typeof getCM>): void {
  if (!cm) return
  if (cm.state.vim?.insertMode) return
  try {
    Vim.handleKey(cm, "i", "user")
  } catch {
    /* noop — best-effort */
  }
}

const modeBridge = ViewPlugin.fromClass(
  class {
    private cm: ReturnType<typeof getCM> | null = null
    private handler: CMHandler | null = null
    private view: EditorView
    private focusListener: (() => void) | null = null

    constructor(view: EditorView) {
      this.view = view
      // `getCM` may return null on the same tick the extension mounts;
      // schedule a microtask retry. Once we have the CM instance we
      // wire the listener and seed the store with the initial mode.
      const attach = () => {
        const cm = getCM(view)
        if (!cm) return false
        this.cm = cm
        setActiveVimMode(normalizeVimMode(cm.state.vim?.mode))
        const handler: CMHandler = e =>
          setActiveVimMode(normalizeVimMode(e.mode))
        this.handler = handler
        cm.on("vim-mode-change", handler)
        // Wire "focus the editor → enter insert mode". This matches
        // the expectation that clicking into a chat composer is
        // always typing-ready; vim users explicitly hit Esc when
        // they want normal mode. Without this, the first click after
        // mount lands the user in normal mode (because the editor
        // booted unfocused) and the keystroke is interpreted as a
        // motion, which feels broken.
        const onFocus = () => enterInsertMode(this.cm)
        view.contentDOM.addEventListener("focus", onFocus)
        this.focusListener = onFocus
        // If the view is already focused at mount, fire once now —
        // the focus event won't replay on its own.
        if (view.hasFocus) enterInsertMode(cm)
        return true
      }
      if (!attach()) queueMicrotask(attach)
    }

    destroy() {
      if (this.cm && this.handler) {
        this.cm.off("vim-mode-change", this.handler)
      }
      if (this.focusListener) {
        this.view.contentDOM.removeEventListener(
          "focus",
          this.focusListener,
        )
      }
      this.cm = null
      this.handler = null
      this.focusListener = null
      setActiveVimMode(null)
    }
  },
)

const extension: Extension = [vim(), modeBridge]

export default extension
