/**
 * Plugin-installer events. All one-way main→renderer.
 *
 * `openPrompt`        : palette-action handler asks the content
 *                       script to show / focus its modal.
 * `installProgress`   : streamed status lines (clone, install,
 *                       register) so the modal can show a log.
 * `installComplete`   : terminal success event — the modal can
 *                       close and show a success toast.
 * `installError`      : terminal failure — modal shows the error
 *                       and leaves the input editable so the user
 *                       can retry.
 */
export type Events = {
  openPrompt: { windowId: string }
  installProgress: {
    phase: "clone" | "install" | "register" | "log"
    message: string
  }
  installComplete: { name: string; path: string }
  installError: { message: string }
}
