import path from "node:path";
import { fileURLToPath } from "node:url";
import { Service } from "@zenbujs/core/runtime";
import { ViewRegistryService } from "@zenbujs/core/services";

const here = path.dirname(fileURLToPath(import.meta.url));
const VIEW_SOURCE = path.resolve(
  here,
  "../../views/git-tree-sidebar-view.tsx",
);

const VIEW_TYPE = "git-tree-sidebar";

/**
 * Registers the right-sidebar git tree as a component view.
 *
 * Replaces the iframe-mode `git-tree-sidebar` registration the
 * host's `GitTreeService` used to own. The `openDiff` RPC + the
 * `git-diff` embed view still live in the host service; this
 * plugin just contributes the sidebar UI.
 */
export class GitTreeSidebarService extends Service.create({
  key: "gitTreeSidebar",
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
          label: "Git tree",
          // Default per-view shortcut picked up by
          // `SidebarViewShortcutsService`. ⌘G already toggles the
          // right sidebar generically; this extra binding *jumps*
          // straight to the Git tree view inside it.
          shortcut: { mod: true, shift: true, key: "g" },
        },
      });
      return () => {
        void this.ctx.viewRegistry.unregisterView(VIEW_TYPE);
      };
    });
  }
}
