import { BrowserWindow, Menu, type MenuItemConstructorOptions } from "electron"
import { Service } from "@zenbujs/core/runtime"

export type ContextMenuItem =
  | { type: "separator" }
  | {
      type?: "normal" | "checkbox"
      id: string
      label: string
      sublabel?: string
      enabled?: boolean
      checked?: boolean
    }

export class ContextMenuService extends Service.create({ key: "contextMenu" }) {
  async show(args: {
    items: ContextMenuItem[]
    x?: number
    y?: number
  }): Promise<{ chosenId: string | null }> {
    const window = BrowserWindow.getFocusedWindow() ?? undefined
    return new Promise(resolve => {
      let chosen: string | null = null
      const template: MenuItemConstructorOptions[] = args.items.map(item => {
        if (item.type === "separator") return { type: "separator" }
        return {
          id: item.id,
          label: item.label,
          sublabel: item.sublabel,
          enabled: item.enabled ?? true,
          type: item.type === "checkbox" ? "checkbox" : "normal",
          checked: item.checked,
          click: () => {
            chosen = item.id
          },
        }
      })
      const menu = Menu.buildFromTemplate(template)
      const popupOptions: Electron.PopupOptions = {
        callback: () => resolve({ chosenId: chosen }),
      }
      if (window) popupOptions.window = window
      if (args.x != null) popupOptions.x = Math.round(args.x)
      if (args.y != null) popupOptions.y = Math.round(args.y)
      menu.popup(popupOptions)
    })
  }
}
