import { definePlugin } from "@zenbujs/core/config"

/**
 * Plugin-dev plugin.
 *
 * Contributes the title-bar surface that appears in windows opened
 * on a locally-scaffolded plugin's source directory (the windows the
 * marketplace sidebar's "Create Plugin" flow spawns). Renders two
 * actions in the title bar:
 *
 *   - **Run in Dev**: spawns a fresh host instance with
 *     `--plugin=<manifest>` argv so the user's in-progress plugin
 *     loads alongside the configured set. Errors surface as
 *     `pluginDevRunError` events the button subscribes to and
 *     toasts.
 *   - **Install Plugin**: appends the plugin's manifest path to the
 *     user's `zenbu.plugins.local.jsonc` overlay, using the same patch logic
 *     `plugin-installer` ships. An info popover next to the button
 *     reminds the user this only installs into their main
 *     application.
 *
 * The buttons only render when the active scope is tagged with a
 * `pluginName` (i.e. opened by `PluginsRootViewService.ensurePluginWorkspace`),
 * so they don't pollute the title bar of normal workspaces.
 *
 * `dependsOn`:
 *  - `app`           \u2014 for the events / db schema this plugin
 *                       contributes events to (`pluginDevRun*`).
 *  - `pluginInstaller` \u2014 same patch-local-plugins helper is shared
 *                       between the github-clone install path and
 *                       this local install path.
 */
export default definePlugin({
  name: "pluginDev",
  services: ["./src/main/services/*.ts"],
  schema: "./src/main/schema.ts",
  migrations: "./migrations",
  dependsOn: [
    { name: "app", from: "../../zenbu.config.ts" },
    {
      name: "pluginInstaller",
      from: "../plugin-installer/zenbu.plugin.ts",
    },
  ],
})
