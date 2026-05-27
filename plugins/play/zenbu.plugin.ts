import { definePlugin } from "@zenbujs/core/config"

/**
 * Play plugin (title-bar Run / Stop / Setup pill).
 *
 * End-to-end isolated from the host:
 *
 *  - Owns its DB section (`root.play.configs`). The host's
 *    previous `root.app.playConfigs` is dropped by `app` migration
 *    `0046`.
 *  - Owns its events (`events.play.playLog`, `events.play.playExit`).
 *  - Owns its main-process service (`PlayService`), which spawns
 *    setup/start commands, collects logs into the per-workspace
 *    collection, and exposes `saveConfig`/`run`/`stop` as
 *    `rpc.play.play.*`.
 *  - Owns its title-bar component view (`play-button`,
 *    `meta.kind = "title-bar"`, `titleBarOrder: 2`).
 *
 * No `dependsOn`: the host doesn't have to expose anything to
 * this plugin anymore. The workspaceId / scopeId / cwd that the
 * service operates on flow through the title-bar's uniform
 * `args` payload and through RPC parameters.
 */
export default definePlugin({
  name: "play",
  services: ["./src/main/services/*.ts"],
  schema: "./src/main/schema.ts",
  events: "./src/main/events.ts",
  migrations: "./migrations",
})
