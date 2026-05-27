import { definePlugin } from "@zenbujs/core/config"

/**
 * Plugin Installer.
 *
 * Adds a "Install plugin from GitHub…" command-palette action.
 * Picking it opens a small modal (injected via content script) where
 * the user pastes a git URL. The main-process service then:
 *
 *   1. `git clone`s the repo into `~/.zenbu/plugins/<name>`.
 *   2. Runs `pnpm install` using the bundled pnpm toolchain.
 *   3. Patches the user's `zenbu.local.ts` (the gitignored local
 *      overlay) to add the new plugin path. The host's hot-reloader
 *      picks the change up automatically — no restart needed.
 *
 * Progress is streamed to the modal via plugin events.
 */
export default definePlugin({
  name: "pluginInstaller",
  services: ["./src/main/services/*.ts"],
  events: "./src/main/events.ts",
  dependsOn: [{ name: "app", from: "../../zenbu.config.ts" }],
})
