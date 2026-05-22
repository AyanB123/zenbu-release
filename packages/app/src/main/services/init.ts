import os from "node:os"
import { Service } from "@zenbujs/core/runtime"
import { DbService, WindowService } from "@zenbujs/core/services"
import { buildContextMenuPrepend } from "../lib/context-menu-prepend"

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

    await this.ctx.window.openView({
      type: "entrypoint",
      baseWindow: {
        trafficLightPosition: { x: 14, y: 12 },
      },
      contextMenu: { prepend: buildContextMenuPrepend() },
    })
  }
}
