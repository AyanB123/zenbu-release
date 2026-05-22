import { definePlugin } from "@zenbujs/core/config";

/**
 * Plan plugin.
 *
 * Contributes:
 *  - a Pi extension (`src/extension/index.ts`) registering a `plan`
 *    tool the LLM can call with `{ title, markdown }`,
 *  - a renderer-side advice (`src/content/plan-tool-advice.tsx`)
 *    that intercepts the host's `ToolCall` component when
 *    `toolName === "plan"` and renders an "Open Plan" card,
 *  - a `plan` view (`src/views/plan/`) that renders the Markdown
 *    in a split pane (mermaid diagrams included via Streamdown).
 *
 * The plugin reaches into the host through two generic primitives —
 * `PiExtensionRegistryService.register(...)` and the host's
 * `openViewInActivePane` event — so the host stays free of any
 * `plan`-specific code.
 */
export default definePlugin({
  name: "plan",
  services: ["./src/main/services/*.ts"],
  dependsOn: [
    // Required for typed access to the host's RPC (`rpc.app.openViewInActivePane`
    // emit) and to import the `PiExtensionRegistryService` class as a service
    // dependency.
    { name: "app", from: "../../zenbu.config.ts" },
  ],
});
