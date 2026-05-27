import { definePlugin } from "@zenbujs/core/config";

/**
 * Context-window right-sidebar plugin.
 *
 * Contributes a single `rendering: "component"` view,
 * `context-sidebar`, tagged with `meta.kind = "view"` +
 * `meta.sidebar = true` so the host's right-sidebar surface
 * picks it up.
 *
 * The view itself is a thin React component that derives the
 * active session from the host's DB (windowState walk → active
 * chat → ready session id) and renders a fixed cells × rows
 * grid visualizing `session.stats.contextUsage`. Because
 * component views share the host's React tree, the component
 * can `useDb` against the host's services with no
 * iframe/postMessage bridge.
 *
 * Depends on `app` for typed access to the host's DB schema.
 */
export default definePlugin({
  name: "contextSidebar",
  services: ["./src/main/services/*.ts"],
  dependsOn: [{ name: "app", from: "../../zenbu.config.ts" }],
});
