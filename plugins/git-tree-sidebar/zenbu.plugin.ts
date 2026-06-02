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
  icons: {
    // lucide: git-branch
    "git-tree-sidebar":
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6a9 9 0 0 0-9 9V3"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/></svg>',
  },
});
