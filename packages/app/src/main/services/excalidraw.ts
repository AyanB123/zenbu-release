import { Service } from "@zenbujs/core/runtime"
import {
  RendererHostService,
  ViewRegistryService,
} from "@zenbujs/core/services"

/**
 * Registers the `"excalidraw"` view — a freeform whiteboard backed by
 * `@excalidraw/excalidraw`. Stateless on the main side for now: the
 * drawing lives entirely in the renderer's component state. We can
 * persist it via the replica later if we want it to survive reloads.
 */
export class ExcalidrawService extends Service.create({
  key: "excalidraw",
  deps: {
    viewRegistry: ViewRegistryService,
    // Order-only: registerAlias("app", …) needs the renderer's vite
    // server to already be live.
    rendererHost: RendererHostService,
  },
}) {
  evaluate() {
    this.setup("register-view", () => {
      this.ctx.viewRegistry.registerAlias({
        type: "excalidraw",
        reloaderId: "app",
        pathPrefix: "/views/excalidraw",
        meta: { kind: "view", label: "Excalidraw" },
      })
      return () => {
        void this.ctx.viewRegistry.unregister("excalidraw")
      }
    })
  }
}
