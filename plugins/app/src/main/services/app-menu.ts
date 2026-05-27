import { app, Menu, type MenuItemConstructorOptions } from "electron"
import { Service, runtime } from "@zenbujs/core/runtime"
import { RpcService } from "@zenbujs/core/services"

/**
 * temporary hack until we fix in zenbu.js to prevent built in shortcuts like cmd + w from closing screen
 */
export class AppMenuService extends Service.create({
  key: "app-menu",
  deps: { rpc: RpcService },
}) {
  evaluate() {
    this.setup("install-menu", () => {
      const prev = Menu.getApplicationMenu()
      const template = this.buildTemplate()
      const menu = Menu.buildFromTemplate(template)
      const apply = () => Menu.setApplicationMenu(menu)
      if (app.isReady()) {
        apply()
      } else {
        void app.whenReady().then(apply)
      }
      return () => {
        // Restore whatever menu was set before us so hot reload doesn't
        // leave the app stuck on a stale template if the service is
        // re-evaluated.
        Menu.setApplicationMenu(prev)
      }
    })
  }

  private buildTemplate(): MenuItemConstructorOptions[] {
    const isMac = process.platform === "darwin"
    const closeActiveTab: MenuItemConstructorOptions = {
      label: "Close Tab",
      accelerator: "CmdOrCtrl+W",
      click: () => {
        this.ctx.rpc.emit.app.closeActivePane({ source: "menu" })
      },
    }

    const fileMenu: MenuItemConstructorOptions = {
      label: "File",
      submenu: [
        closeActiveTab,
        // We intentionally don't add anything else here. The host
        // already exposes `New Chat` / `Open Settings` etc. via
        // shortcuts + palette; duplicating them in the menu just
        // creates two sources of truth for accelerators that could
        // drift apart.
      ],
    }

    const editMenu: MenuItemConstructorOptions = {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        ...(isMac
          ? ([
              { role: "pasteAndMatchStyle" },
              { role: "delete" },
              { role: "selectAll" },
              { type: "separator" },
              {
                label: "Speech",
                submenu: [
                  { role: "startSpeaking" },
                  { role: "stopSpeaking" },
                ],
              },
            ] as MenuItemConstructorOptions[])
          : ([
              { role: "delete" },
              { type: "separator" },
              { role: "selectAll" },
            ] as MenuItemConstructorOptions[])),
      ],
    }

    const viewMenu: MenuItemConstructorOptions = {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    }

    const windowMenu: MenuItemConstructorOptions = {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        ...(isMac
          ? ([
              { type: "separator" },
              { role: "front" },
              { type: "separator" },
              { role: "window" },
            ] as MenuItemConstructorOptions[])
          : ([] as MenuItemConstructorOptions[])),
      ],
    }

    const template: MenuItemConstructorOptions[] = []

    if (isMac) {
      template.push({
        label: app.name,
        submenu: [
          { role: "about" },
          { type: "separator" },
          { role: "services" },
          { type: "separator" },
          { role: "hide" },
          { role: "hideOthers" },
          { role: "unhide" },
          { type: "separator" },
          { role: "quit" },
        ],
      })
    }

    template.push(fileMenu, editMenu, viewMenu, windowMenu)
    return template
  }
}

runtime.register(AppMenuService, import.meta)
