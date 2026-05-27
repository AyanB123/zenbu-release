import os from "node:os"
import { Service } from "@zenbujs/core/runtime"
import { DbService, WindowService } from "@zenbujs/core/services"
import { skeletonRouteForActiveView } from "../../shared/boot-skeleton"
import type { Schema } from "../schema"
import { buildContextMenuPrepend } from "../lib/context-menu-prepend"

function initialSkeletonRoute(root: { app: Pick<Schema, "windowStates"> }): string {
  return skeletonRouteForActiveView(root.app.windowStates.main?.activeView)
}

export class InitService extends Service.create({
  key: "init",
  deps: { window: WindowService, db: DbService },
}) {
  async evaluate() {
    // Stamp the user's home dir into replicated state so the
    // renderer can collapse absolute paths to `~/...` without a
    // per-render RPC round-trip.
    const homeDir = os.homedir()
    await this.ctx.db.client.update(root => {
      if (root.app.env.homeDir !== homeDir) {
        root.app.env.homeDir = homeDir
      }
    })

    const root = this.ctx.db.client.readRoot()

    await this.ctx.window.openView({
      type: "entrypoint",
      query: { skeletonRoute: initialSkeletonRoute(root) },
      baseWindow: {
        trafficLightPosition: { x: 14, y: 12 },
      },
      contextMenu: { prepend: buildContextMenuPrepend() },
    })
  }
}
