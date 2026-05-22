import { BrowserWindow, dialog } from "electron"
import { Service } from "@zenbujs/core/runtime"

export type PickFolderResult =
  | { cancelled: true }
  | { cancelled: false; path: string }

export class DialogService extends Service.create({ key: "dialog" }) {
  async pickFolder(): Promise<PickFolderResult> {
    const parent = BrowserWindow.getFocusedWindow() ?? undefined
    const result = parent
      ? await dialog.showOpenDialog(parent, {
          properties: ["openDirectory", "createDirectory"],
        })
      : await dialog.showOpenDialog({
          properties: ["openDirectory", "createDirectory"],
        })
    if (result.canceled || result.filePaths.length === 0) {
      return { cancelled: true }
    }
    return { cancelled: false, path: result.filePaths[0] }
  }
}
