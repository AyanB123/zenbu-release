import { Service } from "@zenbujs/core/runtime"
import {
  RendererHostService,
  RpcService,
  ViewRegistryService,
} from "@zenbujs/core/services"

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
    // Order-only: registerAlias("app", …) needs the renderer's vite
    // server to already be live.
    rendererHost: RendererHostService,
  },
}) {
  evaluate() {
    this.setup("register-sidebar-view", () => {
      this.ctx.viewRegistry.registerAlias({
        type: "git-tree-sidebar",
        reloaderId: "app",
        pathPrefix: "/views/git-tree-sidebar",
        meta: { kind: "view", sidebar: true, label: "Git tree" },
      })
      return () => {
        void this.ctx.viewRegistry.unregister("git-tree-sidebar")
      }
    })

    this.setup("register-diff-view", () => {
      this.ctx.viewRegistry.registerAlias({
        type: "git-diff",
        reloaderId: "app",
        pathPrefix: "/views/git-diff",
        // `kind: "embed"` keeps the view out of the command palette
        // (it needs args to be meaningful) while still letting other
        // services open it via `useOpenView`.
        meta: { kind: "embed", label: "Diff" },
      })
      return () => {
        void this.ctx.viewRegistry.unregister("git-diff")
      }
    })
  }

  /** Called by the git-tree sidebar view when the user clicks a file.
   * Re-broadcasts as an `openDiffInActivePane` event so the main shell
   * (which owns the pane layout) can split off a new pane with the
   * `git-diff` view in it. Mirrors `FileTreeService.openFile`. */
  async openDiff(args: {
    directory: string
    path: string
  }): Promise<{ ok: true }> {
    this.ctx.rpc.emit.app.openDiffInActivePane({
      directory: args.directory,
      path: args.path,
    })
    return { ok: true }
  }
}
