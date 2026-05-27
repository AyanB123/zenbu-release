import { definePlugin } from "@zenbujs/core/config";

/**
 * cm-markdown plugin.
 *
 * Contributes an Obsidian-style inline live-preview CodeMirror
 * extension to every composer in the host renderer. The extension
 * is registered with `meta.kind = "cm.composer-extension"`; the
 * composer reads the function registry directly and merges every
 * such contribution into its compartment.
 *
 * Disabling this plugin (removing it from `zenbu.config.ts`)
 * removes the live-preview behavior with zero edits to the host.
 */
export default definePlugin({
  name: "cmMarkdown",
  services: ["./src/main/services/*.ts"],
});
