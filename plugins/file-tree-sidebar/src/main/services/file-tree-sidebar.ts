import { Service } from "@zenbujs/core/runtime";

const NAME = "file-tree-sidebar";

/**
 * Right-sidebar file tree.
 *
 * The data + indexing pipeline still lives in the host's
 * `FileTreeService` (FS watcher, `root.app.fileTreeIndexes`);
 * this plugin just surfaces it as an isolated UI contribution.
 */
export class FileTreeSidebarService extends Service.create({
  key: "fileTreeSidebar",
}) {
  evaluate() {
    this.setup("inject-view", () =>
      this.inject({
        name: NAME,
        modulePath: "./src/views/file-tree-sidebar-view.tsx",
        meta: {
          kind: "right-sidebar",
          label: "Files",
          // Mirrors VS Code's "Explorer" accelerator. Picked up by
          // `SidebarViewShortcutsService`.
          shortcut: { mod: true, shift: true, key: "e" },
        },
      }),
    );
  }
}
