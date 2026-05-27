import { definePlugin } from "@zenbujs/core/config";

/**
 * Settings plugin.
 *
 * Two component views, no iframes:
 *
 *   - `"settings"` — the main settings panel (theme, send-mode,
 *     chat background, accounts, pi, keyboard shortcuts). Rendered
 *     in any pane the same way as every other view, plus opened
 *     globally (workspace-less) when triggered from the rail.
 *   - `"settings-rail-button"` — a `meta.kind = "workspace-rail"`
 *     view that draws the gear button at the bottom of the host's
 *     workspace rail. Clicking it emits `events.app.openSettings`,
 *     which the host already routes to `openSettingsInRoot`.
 *
 * Owns its own DB section (`root.settings.ui`) for state that is
 * truly internal to the settings UI — currently just the last
 * selected tab so deep-linking and re-opening feel sticky. The
 * actual configuration the panels read/write (`root.app.settings.*`,
 * pi auth, etc.) lives in the plugins that own those subsystems
 * and is accessed via the typed `dependsOn` surface.
 */
export default definePlugin({
  name: "settings",
  services: ["./src/main/services/*.ts"],
  schema: "./src/main/schema.ts",
  migrations: "./migrations",
  dependsOn: [{ name: "app", from: "../../zenbu.config.ts" }],
});
