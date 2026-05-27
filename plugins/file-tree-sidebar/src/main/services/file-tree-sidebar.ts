import path from "node:path";
import { fileURLToPath } from "node:url";
import { Service } from "@zenbujs/core/runtime";
import { ViewRegistryService } from "@zenbujs/core/services";

const here = path.dirname(fileURLToPath(import.meta.url));
const VIEW_SOURCE = path.resolve(
  here,
  "../../views/file-tree-sidebar-view.tsx",
);

const VIEW_TYPE = "file-tree-sidebar";

/**
 * Registers the right-sidebar file tree as a component view.
 *
 * Replaces the iframe-mode `file-tree-sidebar` registration the
 * host's `FileTreeService` used to own. The data + indexing
 * pipeline still lives in the host (it owns the FS watcher and
 * the `root.app.fileTreeIndexes` table); this plugin just
 * surfaces it as an isolated UI contribution.
 */
export class FileTreeSidebarService extends Service.create({
  key: "fileTreeSidebar",
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
          label: "Files",
          // Default per-view shortcut picked up by
          // `SidebarViewShortcutsService`. Mirrors the VS Code
          // "Explorer" accelerator.
          shortcut: { mod: true, shift: true, key: "e" },
        },
      });
      return () => {
        void this.ctx.viewRegistry.unregisterView(VIEW_TYPE);
      };
    });
  }
}
