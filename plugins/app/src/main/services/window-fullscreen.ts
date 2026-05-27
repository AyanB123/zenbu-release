import type { BaseWindow } from "electron"
import { Service } from "@zenbujs/core/runtime"
import { BaseWindowService, DbService } from "@zenbujs/core/services"

/** Mirrors each BaseWindow's native fullscreen state into
 * `windowStates[windowId].fullscreen`. Title bar reads it to drop
 * the traffic-light gutter when the lights aren't drawn.
 *
 * BaseWindowService has no "created" event, so we poll its map
 * every 1s to attach listeners to new windows. */
export class WindowFullscreenService extends Service.create({
  key: "windowFullscreen",
  deps: { baseWindow: BaseWindowService, db: DbService },
}) {
  private attached = new WeakSet<BaseWindow>()

  evaluate() {
    this.setup("discover-and-attach", () => {
      const scan = () => this.scan()
      scan()
      const interval = setInterval(scan, 1000)
      return () => clearInterval(interval)
    })
  }

  private scan() {
    for (const [windowId, win] of this.ctx.baseWindow.windows) {
      if (this.attached.has(win)) continue
      this.attached.add(win)
      this.attachListeners(windowId, win)
      this.writeFullscreen(windowId, win.isFullScreen())
    }
  }

  private attachListeners(windowId: string, win: BaseWindow) {
    const onEnter = () => this.writeFullscreen(windowId, true)
    const onLeave = () => this.writeFullscreen(windowId, false)
    win.on("enter-full-screen", onEnter)
    win.on("leave-full-screen", onLeave)
    win.once("closed", () => {
      win.removeListener("enter-full-screen", onEnter)
      win.removeListener("leave-full-screen", onLeave)
    })
  }

  private writeFullscreen(windowId: string, value: boolean) {
    void this.ctx.db.client.update(root => {
      const ws = root.app.windowStates[windowId]
      if (!ws || ws.fullscreen === value) return
      ws.fullscreen = value
    })
  }
}
