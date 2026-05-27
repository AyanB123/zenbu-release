/**
 * Renderer-internal signal for "please focus the composer bound to
 * this chat id". Used by surfaces that swap the active tab's chatId
 * in place — the composer's EditorView is reused across chat
 * switches so it only auto-focuses on mount, and the seam between
 * "old chat" and "new chat" otherwise wouldn't refocus the input.
 *
 * Goes through `window.dispatchEvent` rather than the main-process
 * event bus because both the dispatcher (sidebar / shortcut handler)
 * and the listener (composer) live in the same renderer. Avoiding
 * the extra IPC hop keeps it instant.
 */
const FOCUS_COMPOSER_EVENT = "zenbu:focus-composer"

export type FocusComposerDetail = { composerId: string }

export function requestFocusComposer(composerId: string): void {
  if (typeof window === "undefined") return
  window.dispatchEvent(
    new CustomEvent<FocusComposerDetail>(FOCUS_COMPOSER_EVENT, {
      detail: { composerId },
    }),
  )
}

export function subscribeFocusComposer(
  composerId: string,
  onFocus: () => void,
): () => void {
  if (typeof window === "undefined") return () => {}
  const handler = (e: Event) => {
    const detail = (e as CustomEvent<FocusComposerDetail>).detail
    if (detail?.composerId !== composerId) return
    onFocus()
  }
  window.addEventListener(FOCUS_COMPOSER_EVENT, handler)
  return () => window.removeEventListener(FOCUS_COMPOSER_EVENT, handler)
}
