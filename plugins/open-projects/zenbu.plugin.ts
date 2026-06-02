import { definePlugin } from "@zenbujs/core/config"

/**
 * Open Projects palette (⌘⇧O): fuzzy picker over project folders
 * under `$HOME`, indexed by a utility-process worker into a
 * replicated collection. Picking a row calls
 * `rpc.app.workspaces.createFromDirectory`.
 */
export default definePlugin({
  name: "openProjects",
  services: ["./src/main/services/*.ts"],
  schema: "./src/main/schema.ts",
  events: "./src/main/events.ts",
  migrations: "./migrations",
  dependsOn: [{ name: "app", from: "../../zenbu.config.ts" }],
})
