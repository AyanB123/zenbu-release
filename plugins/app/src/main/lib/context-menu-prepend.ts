import { clipboard, type WebContents } from "electron"
import { runtime } from "@zenbujs/core/runtime"

/**
 * Builds the right-click context-menu `prepend` for `WindowService.openView`.
 *
 * The framework's default `prepend` (in `@zenbujs/core`) provides
 * "Reload window" and "Reload main process". Passing a `prepend` to
 * `openView({ contextMenu: { prepend } })` REPLACES that default, so
 * we have to recreate those items here and tack on our own (currently
 * just "Copy URL").
 *
 * Returns a function matching the `electron-context-menu` `prepend`
 * signature: `(defaults, params, browserWindow) => MenuItemConstructorOptions[]`.
 * We pull `WebContents` off the `browserWindow` arg (which the framework
 * sets to the view's `WebContentsView`) so reload/url operations target
 * the surface the user actually right-clicked into.
 */
export function buildContextMenuPrepend() {
  return (_defaults: unknown, params: { pageURL?: string }, browserWindow: unknown) => {
    const webContents = resolveWebContents(browserWindow)
    return [
      {
        label: "Reload window",
        click: () => {
          try {
            webContents?.reload()
          } catch (err) {
            console.error("context menu: reload window failed:", err)
          }
        },
      },
      {
        label: "Reload main process",
        click: () => {
          runtime.reloadAll().catch(err => {
            console.error("context menu: reload main process failed:", err)
          })
        },
      },
      {
        label: "Copy URL",
        click: () => {
          try {
            const url = webContents?.getURL() ?? params.pageURL ?? ""
            clipboard.writeText(url)
          } catch (err) {
            console.error("context menu: copy URL failed:", err)
          }
        },
      },
      { type: "separator" as const },
    ]
  }
}

function resolveWebContents(target: unknown): WebContents | null {
  if (!target || typeof target !== "object") return null
  // `WebContentsView` / `BrowserView` / `BrowserWindow` all expose a
  // `webContents` getter. Bare `WebContents` instances have `reload`
  // directly on them.
  const maybeView = target as { webContents?: WebContents }
  if (maybeView.webContents) return maybeView.webContents
  const maybeWc = target as Partial<WebContents>
  if (typeof maybeWc.reload === "function" && typeof maybeWc.getURL === "function") {
    return target as WebContents
  }
  return null
}
