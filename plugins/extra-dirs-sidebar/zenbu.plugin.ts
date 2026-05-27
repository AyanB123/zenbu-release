import { definePlugin } from "@zenbujs/core/config";

/**
 * Extra-directories right-sidebar plugin.
 *
 * Contributes a single `rendering: "component"` view, `extra-dirs`,
 * tagged with `meta.kind = "view"` + `meta.sidebar = true` so the
 * host's right-sidebar tab strip picks it up and renders a tab for
 * it. Labeled "Add dir to context" in the tab tooltip.
 *
 * The view itself is a thin React component that reads
 * `scope.extraDirectories` for the active scope (via the host's DB
 * shape) and provides reveal / copy / remove / add affordances. It
 * runs in-process inside the host renderer realm — component views
 * share the host tree, so the plugin can `useDb` / `useRpc` against
 * the host's services with no postMessage bridge.
 *
 * Depends on `app` for typed access to the host's DB schema and RPC
 * methods (`dialog.openInFileBrowser`, `dialog.pickFolder`,
 * `contextMenu.show`).
 */
export default definePlugin({
  name: "extraDirsSidebar",
  services: ["./src/main/services/*.ts"],
  dependsOn: [{ name: "app", from: "../../zenbu.config.ts" }],
});
