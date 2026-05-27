/**
 * Recent-workspaces events. One-way main→renderer.
 *
 * `togglePalette` — emitted by the registered shortcut handler and
 * by the palette action's RPC dispatch. The content-script-mounted
 * palette subscribes and flips its open state.
 */
export type Events = {
  togglePalette: { source: string }
}
