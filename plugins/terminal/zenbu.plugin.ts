import { definePlugin } from "@zenbujs/core/config";

/**
 * Terminal bottom-panel plugin.
 *
 * Contributes a single `rendering: "component"` view, `terminal`,
 * tagged with `meta.kind = "view"` + `meta.bottomPanel = true` so
 * the host shell's bottom-panel surface picks it up (mirroring how
 * `file-tree-sidebar` opts into the right-sidebar surface).
 *
 * The PTY lifecycle + DB state still live in the host's
 * `TerminalService` (it owns `@lydell/node-pty` and the
 * `root.app.terminals` table). This plugin just surfaces that state
 * as an isolated UI contribution and drives it via
 * `rpc.app.terminal.{create,attach,write,resize,dispose}` +
 * `events.app.terminal{Data,Exit}`.
 *
 * Depends on `app` for typed access to the host's DB schema, RPC,
 * and events.
 */
export default definePlugin({
  name: "terminal",
  services: ["./src/main/services/*.ts"],
  dependsOn: [{ name: "app", from: "../../zenbu.config.ts" }],
});
