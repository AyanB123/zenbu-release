import { definePlugin } from "@zenbujs/core/config";

/**
 * Git-tree right-sidebar plugin.
 *
 * Contributes a single `rendering: "component"` view,
 * `git-tree-sidebar`, tagged with `meta.kind = "view"` +
 * `meta.sidebar = true`.
 *
 * Caches per-scope git status in `root.gitTreeSidebar.statuses`
 * (refreshed on demand). Clicking a file calls `rpc.app.gitTree.openDiff`.
 */
export default definePlugin({
  name: "gitTreeSidebar",
  services: ["./src/main/services/*.ts"],
  schema: "./src/main/schema.ts",
  migrations: "./migrations",
  dependsOn: [{ name: "app", from: "../../zenbu.config.ts" }],
});
