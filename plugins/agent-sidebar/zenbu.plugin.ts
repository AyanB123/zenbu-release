import { definePlugin } from "@zenbujs/core/config";

/**
 * Agent left-sidebar plugin.
 *
 * Owns the chat list — the default left-sidebar tab. Registers a
 * `rendering: "component"` view of type `"agent"` tagged
 * `meta.kind = "left-sidebar"`, so the host's
 * `LeftSidebarTabBar` lists it alongside other plugin-contributed
 * tabs.
 *
 * The view itself is a thin React component that pulls together
 * the chat list, worktree groups, split-button header, and the
 * sidebar footer. It runs in-process inside the host renderer
 * realm — component views share the host tree, so the plugin can
 * reach into the host's shared selectors, RPC, and DB types
 * directly via the `@/` alias (configured in this plugin's
 * `tsconfig.json` and resolved at runtime by the host's Vite
 * server).
 *
 * Depends on `app` for typed access to the host's schema and RPC.
 */
export default definePlugin({
  name: "agentSidebar",
  services: ["./src/main/services/*.ts"],
  schema: "./src/main/schema.ts",
  migrations: "./migrations",
  events: "./src/main/events.ts",
  dependsOn: [{ name: "app", from: "../../zenbu.config.ts" }],
});
