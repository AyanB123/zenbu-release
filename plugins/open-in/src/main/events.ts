/**
 * Open-in events. One-way main→renderer.
 *
 * Three triggers — the keyboard shortcut and the three command-palette
 * actions all funnel through these. The renderer-side button view
 * (`open-in-button-view.tsx`) subscribes and either performs the open
 * directly (`openDefault`) or pops a fuzzy picker built on
 * `@zenbu/ui/palette` (`openChoose`, `openSetDefault`).
 *
 *   - `openDefault`    — Cmd+Shift+O (or palette: "Open in default").
 *                        Opens the active scope's directory in the
 *                        user's preferred app immediately, no UI.
 *   - `openChoose`     — Palette: "Open in…". Pops a sub-palette of
 *                        every indexed folder-opener; activating a row
 *                        opens the directory in that app (one-shot,
 *                        does NOT change the default).
 *   - `openSetDefault` — Palette: "Open in: Set default". Same picker
 *                        UI, but activating sets `defaultBundlePath`
 *                        instead of opening anything — turning the
 *                        palette into the discoverable equivalent of
 *                        the title-bar split button's chevron menu.
 *
 * `source` is informational ("shortcut" | "palette") — useful when
 * debugging which surface fired, ignored otherwise.
 */
export type Events = {
  openDefault: { source: string }
  openChoose: { source: string }
  openSetDefault: { source: string }
}
