import { Service } from "@zenbujs/core/runtime";

const NAME = "agent";

/**
 * Agent sidebar service.
 *
 * Injects the chat-list view under `name = "agent"` so the host's
 * left-sidebar discovery hook (`useInjections({ kind: "left-sidebar" })`)
 * picks it up as a tab. The active tab body is rendered with
 * `<View name="agent" />`.
 *
 * The label / icon shown on the tab come from `meta.label` and the
 * plugin manifest's `icons[name]` (auto-attached to `meta.icon` by
 * `this.inject(...)`).
 */
export class AgentSidebarService extends Service.create({
  key: "agentSidebar",
}) {
  evaluate() {
    this.setup("inject-view", () =>
      this.inject({
        name: NAME,
        modulePath: "./src/views/agent-sidebar-view.tsx",
        meta: {
          kind: "left-sidebar",
          label: "Agents",
          // Chat list is the conventional first tab. Multiples of
          // 10 leave room for other plugins to slot between.
          order: 10,
          // Read by `SidebarViewShortcutsService` to default-bind a
          // per-view shortcut + palette action. `mod: true` becomes
          // `meta` on macOS and `control` elsewhere.
          shortcut: { mod: true, shift: true, key: "1" },
        },
      }),
    );
  }
}
