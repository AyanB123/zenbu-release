import { Service } from "@zenbujs/core/runtime"
import {
  RendererHostService,
  ViewRegistryService,
} from "@zenbujs/core/services"

/**
 * Registers the `"context-sidebar"` view: a right-rail visualizer for
 * the active session's context-window usage. Reads
 * `root.app.sessions[active].stats` + `root.app.models` directly so
 * the grid + breakdown render off the local replica with no RPC.
 *
 * The view itself lives at `src/renderer/views/context-sidebar` and
 * is aliased over the renderer's vite server so it shares tailwind
 * and theme vars (same trick as file-tree-sidebar / pi-event-log).
 */
export class ContextSidebarService extends Service.create({
  key: "contextSidebar",
  deps: {
    viewRegistry: ViewRegistryService,
    // Order-only: `registerAlias("app", …)` needs the renderer's vite
    // server live before we point at one of its sub-paths.
    rendererHost: RendererHostService,
  },
}) {
  evaluate() {
    this.setup("register-view", () => {
      this.ctx.viewRegistry.registerAlias({
        type: "context-sidebar",
        reloaderId: "app",
        pathPrefix: "/views/context-sidebar",
        meta: { kind: "view", sidebar: true, label: "Context" },
      })
      return () => {
        void this.ctx.viewRegistry.unregister("context-sidebar")
      }
    })
  }
}
