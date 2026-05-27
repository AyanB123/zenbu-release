import path from "node:path"
import { fileURLToPath } from "node:url"
import { Service } from "@zenbujs/core/runtime"
import { RpcService, ViewRegistryService } from "@zenbujs/core/services"

const here = path.dirname(fileURLToPath(import.meta.url))

/**
 * Registers two views that, taken together, give us a sidebar
 * counterpart to the file-tree:
 *
 *  - `"git-tree-sidebar"` — sidebar view (`meta.sidebar: true`). Renders
 *      a `@pierre/trees` tree of only the changed paths returned by
 *      `pr.getStatus`, with the library's built-in `gitStatus` decoration.
 *      Clicking a file calls `openDiff({...})` which emits
 *      `openDiffInActivePane` for the main shell.
 *
 *  - `"git-diff"` — pane view (`meta.kind: "embed"`, takes `{ directory,
 *      path }` args). Fetches the live `pr.getStatus`, finds the matching
 *      entry, and renders the existing `<DiffViewer>` so the diff shown
 *      here is identical to what the full Git view shows.
 *
 * Both views are vite-aliased over the renderer's server so they share
 * tailwind / theme vars (same trick file-tree + pi-event-log use).
 */
export class GitTreeService extends Service.create({
  key: "gitTree",
  deps: {
    viewRegistry: ViewRegistryService,
    // Needed so we can emit `openDiffInActivePane` when the sidebar
    // view asks to open a file.
    rpc: RpcService,
  },
}) {
  evaluate() {
    // Note: the right-sidebar `git-tree-sidebar` view used to be
    // registered here. It now lives in the standalone
    // `@zenbu/git-tree-sidebar` plugin as a
    // `rendering: "component"` view, which calls back into
    // `rpc.app.gitTree.openDiff` (still owned here).

    this.setup("register-diff-view", () => {
      this.ctx.viewRegistry.registerView({
        type: "git-diff",
        rendering: "component",
        source: {
          modulePath: path.resolve(
            here,
            "../../renderer/views/git-diff/git-diff-view.tsx",
          ),
        },
        // `kind: "embed"` keeps the view out of the command palette
        // (it needs args to be meaningful) while still letting other
        // services open it via `useOpenView`.
        meta: { kind: "embed", label: "Diff" },
      })
      return () => {
        void this.ctx.viewRegistry.unregisterView("git-diff")
      }
    })
  }

  /** Called by the git-tree sidebar view OR a turn-summary card
   * when the user clicks a file. Re-broadcasts as an
   * `openDiffInActivePane` event so the main shell (which owns the
   * pane layout) can split off a new pane with the `git-diff` view
   * in it. Mirrors `FileTreeService.openFile`.
   *
   * `workspaceId` + `scopeId` are required so the shell knows
   * *where* to open the diff. The git-tree sidebar reads them off
   * its own `useActiveScope`; the turn-summary card reads them off
   * the chat that owns the summary. Without them the shell would
   * fall back to the window's currently-active workspace, which
   * is exactly the bug we hit when a user clicked a turn-summary
   * card while focused on a different workspace's chat — the diff
   * would teleport them into the wrong workspace. */
  async openDiff(args: {
    workspaceId: string
    scopeId: string
    directory: string
    path: string
  }): Promise<{ ok: true }> {
    this.ctx.rpc.emit.app.openDiffInActivePane({
      workspaceId: args.workspaceId,
      scopeId: args.scopeId,
      directory: args.directory,
      path: args.path,
    })
    return { ok: true }
  }
}
