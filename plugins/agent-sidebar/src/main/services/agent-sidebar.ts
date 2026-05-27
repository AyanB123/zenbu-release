import path from "node:path";
import { fileURLToPath } from "node:url";
import { Service } from "@zenbujs/core/runtime";
import { ViewRegistryService } from "@zenbujs/core/services";

const here = path.dirname(fileURLToPath(import.meta.url));
const VIEW_SOURCE = path.resolve(here, "../../views/agent-sidebar-view.tsx");

const VIEW_TYPE = "agent";

/**
 * Agent sidebar service.
 *
 * Registers the chat-list view as `rendering: "component"` so the
 * host renders it in-process — no iframe, no postMessage. Tagged
 * `meta.kind = "left-sidebar"` so the host's `LeftSidebarTabBar`
 * picks it up as a tab. The host renders the active tab's view in
 * the sidebar body via `<View type={tabId} />`.
 *
 * The label / icon shown on the tab come from the view registry
 * metadata + the host's icon manifest (the `"agent"` icon entry
 * in `plugins/app/zenbu.plugin.ts#icons`).
 */
export class AgentSidebarService extends Service.create({
  key: "agentSidebar",
  deps: { viewRegistry: ViewRegistryService },
}) {
  evaluate() {
    this.setup("register-view", () => {
      void this.ctx.viewRegistry.registerView({
        type: VIEW_TYPE,
        rendering: "component",
        source: { modulePath: VIEW_SOURCE },
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
      });
      return () => {
        void this.ctx.viewRegistry.unregisterView(VIEW_TYPE);
      };
    });
  }
}
