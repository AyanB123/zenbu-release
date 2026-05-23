import { BrowserWindow, dialog, shell } from "electron"
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

  /**
   * Open the given absolute path in the OS file browser. Used by the
   * extra-dirs sidebar's "Reveal in Finder" row action. We call
   * `shell.openPath` so a directory is *opened in* the file browser
   * (rather than `showItemInFolder`, which would highlight the dir
   * inside its parent). Returns the empty string on success and
   * Electron's error string otherwise.
   */
  async openInFileBrowser(args: { path: string }): Promise<{ error: string }> {
    if (!args.path) return { error: "path is required" }
    const error = await shell.openPath(args.path)
    return { error }
  }
}
