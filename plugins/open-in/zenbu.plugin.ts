import { definePlugin } from "@zenbujs/core/config"

/**
 * Open-in plugin.
 *
 * End-to-end isolated from the host:
 *
 *  - Owns its DB section (`root.openIn.apps` +
 *    `root.openIn.settings`). The host's previous
 *    `root.app.openInApps` / `root.app.settings.defaultOpenInBundlePath`
 *    are dropped by the host's matching `app` migration.
 *  - Owns its main-process service (`OpenInService`), which
 *    indexes folder-openers via NSWorkspace + sips and exposes
 *    `openWith({ bundlePath, directory })` as `rpc.openIn.openIn.openWith`.
 *  - Owns its title-bar component view (`open-in-button`,
 *    `meta.kind = "title-bar"`, `titleBarOrder: 1`).
 *
 * No `dependsOn` \u2014 the host no longer needs to expose anything
 * to this plugin.
 */
export default definePlugin({
  name: "openIn",
  services: ["./src/main/services/*.ts"],
  schema: "./src/main/schema.ts",
  events: "./src/main/events.ts",
  migrations: "./migrations",
  // The host's `PaletteActionsService` lives in `plugins/app`. We
  // resolve it by string key (see `open-in.ts`), but we still need
  // to declare the dependency so the host loads `app` first and the
  // service is available when we call `register()` from our own
  // `setup()` block. Same pattern `searchRecentWorkspaces` uses.
  dependsOn: [{ name: "app", from: "../../zenbu.config.ts" }],
})
