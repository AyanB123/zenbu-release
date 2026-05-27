import path from "node:path";
import { fileURLToPath } from "node:url";
import { Service } from "@zenbujs/core/runtime";
import { ViewRegistryService } from "@zenbujs/core/services";

const here = path.dirname(fileURLToPath(import.meta.url));
const VIEW_SOURCE = path.resolve(here, "../../views/extra-dirs-sidebar-view.tsx");

const VIEW_TYPE = "extra-dirs";

/**
 * Extra-directories sidebar service.
 *
 * Registers a single `rendering: "component"` view, `extra-dirs`,
 * pointing at `views/extra-dirs-sidebar-view.tsx`. Tagged with
 * `meta.kind = "view"` + `meta.sidebar = true` so the host's
 * right-sidebar tab strip surfaces it.
 *
 * The host renders `<View type="extra-dirs" />` in the sidebar body
 * when this tab is active. Because component views share the host's
 * React tree, the view can call `useDb` / `useRpc` directly against
 * the `app` plugin.
 */
export class ExtraDirsSidebarService extends Service.create({
  key: "extraDirsSidebar",
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
          label: "Add dir to context",
          // Sort hint for the right-sidebar tab strip. Multiples of
          // 10 leave room for other plugins to slot between.
          order: 20,
          // Read by `SidebarViewShortcutsService` in the host: default
          // shortcut to open this right-sidebar tab.
          shortcut: { mod: true, shift: true, key: "2" },
        },
      });
      return () => {
        void this.ctx.viewRegistry.unregisterView(VIEW_TYPE);
      };
    });
  }
}
