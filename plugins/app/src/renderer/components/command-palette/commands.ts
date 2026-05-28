import type { Command } from "./types"

/**
 * Renderer-side static command list.
 *
 * These are the *only* commands that don't go through
 * `PaletteActionsService`. They live here because their behavior is
 * a renderer-only "morph the palette body into a custom React view"
 * (Raycast-style sub-view) — there is no RPC call to make. For every
 * other command, plugins should register an action via
 * `PaletteActionsService.register({ id, label, rpc: { plugin, service, method } })`
 * from their own service `setup()` block; the renderer picks those
 * up automatically through `useCommands()`.
 *
 * If you find yourself adding to this array, ask whether the command
 * really needs to render its own React view (multi-step picker,
 * embedded form, …). If it just needs to "do a thing", register it
 * via `PaletteActionsService` instead.
 */
export const STATIC_COMMANDS: Command[] = []
