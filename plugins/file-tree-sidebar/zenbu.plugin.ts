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
  icons: {
    // lucide: folder
    "file-tree-sidebar":
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>',
  },
});
