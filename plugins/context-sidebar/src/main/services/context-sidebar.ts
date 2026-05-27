import path from "node:path";
import { fileURLToPath } from "node:url";
import { Service } from "@zenbujs/core/runtime";
import { ViewRegistryService } from "@zenbujs/core/services";

const here = path.dirname(fileURLToPath(import.meta.url));
const VIEW_SOURCE = path.resolve(
  here,
  "../../views/context-sidebar-view.tsx",
);

const VIEW_TYPE = "context-sidebar";

/**
 * Right-sidebar service for the context-window visualizer.
 *
 * Registers a single `rendering: "component"` view, pointing at
 * `views/context-sidebar-view.tsx`. Tagged with
 * `meta.kind = "view"` + `meta.sidebar = true` so the host's
 * right-sidebar tab strip surfaces it.
 *
 * Replaces the old in-app `ContextSidebarService` (which
 * registered an iframe-mode view rooted at
 * `/views/context-sidebar`). The component-mode replacement
 * shares the host renderer's React tree, so it inherits theme /
 * CSS / focus automatically — no `useThemeSync` shim needed.
 */
export class ContextSidebarService extends Service.create({
  key: "contextSidebar",
  deps: { viewRegistry: ViewRegistryService },
}) {
  evaluate() {
    this.setup("register-view", () => {
      void this.ctx.viewRegistry.registerView({
        type: VIEW_TYPE,
        rendering: "component",
        source: { modulePath: VIEW_SOURCE },
        meta: {
          kind: "view",
          sidebar: true,
          label: "Context",
          // Default per-view shortcut picked up by
          // `SidebarViewShortcutsService`.
          shortcut: { mod: true, shift: true, key: "k" },
        },
      });
      return () => {
        void this.ctx.viewRegistry.unregisterView(VIEW_TYPE);
      };
    });
  }
}
