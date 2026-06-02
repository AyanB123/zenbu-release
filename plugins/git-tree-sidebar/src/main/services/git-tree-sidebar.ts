import { Service } from "@zenbujs/core/runtime";

const NAME = "git-tree-sidebar";

/**
 * Right-sidebar git tree.
 *
 * The `openDiff` RPC + the `git-diff` embed view still live in the
 * host's `GitTreeService`; this plugin just contributes the
 * sidebar UI as a component injection.
 */
export class GitTreeSidebarService extends Service.create({
  key: "gitTreeSidebar",
}) {
  evaluate() {
    this.setup("inject-view", () =>
      this.inject({
        name: NAME,
        modulePath: "./src/views/git-tree-sidebar-view.tsx",
        meta: {
          kind: "right-sidebar",
          label: "Git tree",
          // ⌘G already toggles the right sidebar generically; this
          // extra binding *jumps* straight to the Git tree view
          // inside it. Picked up by `SidebarViewShortcutsService`.
          shortcut: { mod: true, shift: true, key: "g" },
        },
      }),
    );
  }
}
