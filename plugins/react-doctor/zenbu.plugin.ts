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
    // lucide v1.16.0 stethoscope, wrapped in the lucide default SVG
    // envelope (xmlns / viewBox / stroke attrs). Copied verbatim from
    // `node_modules/lucide-react/dist/esm/icons/stethoscope.mjs`.
    "react-doctor-sidebar":
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 2v2"/><path d="M5 2v2"/><path d="M5 3H4a2 2 0 0 0-2 2v4a6 6 0 0 0 12 0V5a2 2 0 0 0-2-2h-1"/><path d="M8 15a6 6 0 0 0 12 0v-3"/><circle cx="20" cy="10" r="2"/></svg>',
  },
});
