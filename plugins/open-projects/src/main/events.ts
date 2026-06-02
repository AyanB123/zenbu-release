/**
 * Open-projects events. One-way main\u2192renderer.
 *
 * `togglePalette` is emitted by:
 *   - the registered shortcut handler (\u2318\u21e7O by default),
 *   - the command-palette action ("Open Project\u2026"),
 *   - the tutorial view's "open project" widget.
 *
 * The content-script-mounted palette subscribes and flips its open
 * state. Same pattern as `searchRecentWorkspaces` /
 * `searchRecentAgents`.
 */
export type Events = {
  togglePalette: { source: string }
}
