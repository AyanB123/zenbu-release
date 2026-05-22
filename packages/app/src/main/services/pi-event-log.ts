import { Service } from "@zenbujs/core/runtime"
import {
  RendererHostService,
  ViewRegistryService,
} from "@zenbujs/core/services"

/**
 * Registers the `"pi-event-log"` sidebar view (aliased over the renderer's
 * vite server so it shares tailwind / theme vars, same trick the file-tree
 * service uses). The view itself lives at
 * `src/renderer/views/pi-event-log` and reads `session.eventLog` directly
 * from the DB, so events stream in live without any extra RPC.
 */
export class PiEventLogService extends Service.create({
  key: "piEventLog",
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
        type: "pi-event-log",
        reloaderId: "app",
        pathPrefix: "/views/pi-event-log",
        meta: { kind: "view", label: "Pi Events" },
      })
      return () => {
        void this.ctx.viewRegistry.unregister("pi-event-log")
      }
    })
  }
}
