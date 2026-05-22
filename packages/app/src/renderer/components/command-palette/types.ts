import type { ReactNode } from "react"

export type CommandViewCtx = {
  /** Close the entire palette. */
  close: () => void
  /** Go back to the root command list. */
  back: () => void
}

/**
 * What a command renders into when activated. The view replaces the
 * entire palette body (Raycast-style "morph"). Return one of:
 *  - A `render(ctx)` returning a ReactNode → the palette morphs.
 *  - `null` / `undefined` → palette closes immediately (fire-and-forget).
 */
export type CommandView = {
  /** Title shown in the palette header while this view is active. */
  title?: string
  render: (ctx: CommandViewCtx) => ReactNode
}

export type Command = {
  id: string
  label: string
  /** Right-aligned secondary text on the row (e.g. category or shortcut). */
  hint?: string
  /** Inline SVG (string) or React node icon shown left of the label. */
  icon?: ReactNode
  /**
   * Called when the user activates the command (mouse click or Enter).
   * If it returns a `CommandView`, the palette morphs into that view;
   * otherwise the palette closes.
   */
  onSelect: () =>
    | CommandView
    | null
    | void
    | Promise<CommandView | null | void>
}
