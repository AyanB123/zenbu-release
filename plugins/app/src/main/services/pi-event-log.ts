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
    // Order-only: `registerView({ source: { pathPrefix } })` needs the renderer's vite
    // server live before we point at one of its sub-paths.
    rendererHost: RendererHostService,
  },
}) {
  evaluate() {
    this.setup("register-view", () =>
      this.registerView({
        type: "pi-event-log",
        rendering: "component",
        source: {
          modulePath: "src/renderer/views/pi-event-log/pi-event-log-app.tsx",
          exportName: "PiEventLogApp",
        },
        meta: { kind: "view", label: "Pi Events" },
      }),
    )
  }
}
