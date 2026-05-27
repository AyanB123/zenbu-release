import { definePlugin } from "@zenbujs/core/config";

/**
 * Open-files plugin.
 *
 * Contributes a renderer-side around-advice
 * (`src/content/file-tool-advice.tsx`) on the host's `ToolCall`
 * chat-message component. When the tool call is a `read`, `edit`,
 * or `write` (or, more generally, any tool whose chat card is
 * rendered as a file action), the wrapper renders the original
 * card inside a clickable container that opens the touched file
 * in a new pane.
 *
 * The click path reuses the host's existing
 * `rpc.app.fileTree.openFile`, which emits the generic
 * `openFileInActivePane` event the main shell already routes
 * (mirroring the file-tree sidebar's click handler). The host
 * stays oblivious to this plugin's existence.
 */
export default definePlugin({
  name: "openFiles",
  services: ["./src/main/services/*.ts"],
  dependsOn: [
    // Typed access to the host's RPC (`rpc.app.fileTree.openFile`)
    // and the host DB shape (used to resolve a scope by absolute
    // path at click time).
    { name: "app", from: "../../zenbu.config.ts" },
  ],
});
