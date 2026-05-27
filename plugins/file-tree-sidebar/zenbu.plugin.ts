import { definePlugin } from "@zenbujs/core/config";

/**
 * File-tree right-sidebar plugin.
 *
 * Contributes a single `rendering: "component"` view,
 * `file-tree-sidebar`, tagged with `meta.kind = "view"` +
 * `meta.sidebar = true` so the host's right-sidebar surface
 * picks it up.
 *
 * The view reads the per-scope file index out of
 * `root.app.fileTreeIndexes` (still owned by the host's
 * `FileTreeService`) and renders it with `@pierre/trees`.
 * Clicking a file calls `rpc.app.fileTree.openFile`, which the
 * host re-broadcasts as `openFileInActivePane`.
 *
 * Depends on `app` for typed access to the host's DB schema +
 * `fileTree.openFile` RPC.
 */
export default definePlugin({
  name: "fileTreeSidebar",
  services: ["./src/main/services/*.ts"],
  dependsOn: [{ name: "app", from: "../../zenbu.config.ts" }],
});
