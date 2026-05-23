import { definePlugin } from "@zenbujs/core/config";

/**
 * react-doctor plugin.
 *
 * Contributes:
 *  - a per-scope index of `react-doctor --json` results in
 *    `root.reactDoctor.indexes`, populated automatically when a new
 *    scope appears and refreshable on demand from the sidebar,
 *  - a sidebar view (`src/views/react-doctor-sidebar/`) that renders
 *    the score, summary, per-file diagnostics, and a rescan button.
 *
 * Clicking a diagnostic opens the touched file in the active pane
 * by calling `rpc.app.fileTree.openFile` — same path the file-tree
 * sidebar uses, so the host stays unaware of this plugin's existence.
 */
export default definePlugin({
  name: "reactDoctor",
  services: ["./src/main/services/*.ts"],
  schema: "./src/main/schema.ts",
  migrations: "./migrations",
  dependsOn: [
    // Typed access to the host's `rpc.app.fileTree.openFile` and to
    // `root.app.scopes` so the sidebar can resolve a clicked file
    // back to a scope.
    { name: "app", from: "../../zenbu.config.ts" },
  ],
  icons: {
    "react-doctor-sidebar":
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4v6a5 5 0 0 0 10 0V4"/><path d="M6 4h0"/><path d="M10 4h0"/><path d="M8 15v2a4 4 0 0 0 8 0v-1"/><circle cx="18" cy="14" r="2"/></svg>',
  },
});
