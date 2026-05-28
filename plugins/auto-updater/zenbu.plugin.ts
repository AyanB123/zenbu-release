import { definePlugin } from "@zenbujs/core/config"

/**
 * Auto-updater plugin.
 *
 * Renders a small title-bar item that polls every 10s for plugin
 * repo updates (via the host's core `pluginUpdater` service) and
 * surfaces a single "Restart to update" button when any repo has
 * changes. The click handler decides on the spot whether to fire
 * `applyRepo()` (clean fast-forward — same path as
 * Settings → Updates → Restart) or pop a conflicts modal that
 * builds an agent-resolvable prompt with the relevant diffs.
 *
 * No schema / no events of its own — state lives in the renderer
 * (polled per window) and the only main-side surface is the
 * title-bar view registration plus a `getConflictDiffs` RPC used
 * to assemble the copy-prompt payload.
 */
export default definePlugin({
  name: "autoUpdater",
  services: ["./src/main/services/*.ts"],
})
