import { nanoid } from "nanoid"
import { Service } from "@zenbujs/core/runtime"
import {
  BaseWindowService,
  DbService,
  WindowService,
} from "@zenbujs/core/services"
import { skeletonRouteForActiveView } from "../../shared/boot-skeleton"
import { buildContextMenuPrepend } from "../lib/context-menu-prepend"
import { ReposService } from "./repos"

/**
 * Opens a new BrowserWindow focused on a plugin's source directory.
 *
 * Carved out of the old `plugins-root-view.ts` so the
 * `openPluginInNewWindow` RPC stays available after the
 * plugins-root view (workspace-rail button + full-window
 * surface) was removed in favour of the marketplace left-sidebar
 * tab. The marketplace sidebar's "Create Plugin" flow calls this
 * RPC to land the user in the new plugin's worktree as soon as
 * `create-plugin` finishes.
 *
 * Per-plugin workspace model is unchanged: each plugin gets its
 * own `kind: "plugin"` workspace with a single scope pointing at
 * the plugin's directory, looked up by `scope.pluginName` so
 * moving a plugin on disk doesn't fork its workspace. These
 * workspaces are filtered out of the workspace rail so they stay
 * invisible until the user opens one through the marketplace
 * sidebar.
 *
 * The RPC is exposed under the same key the old service used
 * (`pluginsRootView`) so any callers that referenced
 * `rpc.app.pluginsRootView.openPluginInNewWindow` still work.
 */
export class PluginsRootViewService extends Service.create({
  key: "pluginsRootView",
  deps: {
    db: DbService,
    window: WindowService,
    repos: ReposService,
    // Used to peek the parent's main-window bounds before opening
    // the plugin window, so the new window lands offset from the
    // parent instead of landing on top of it. Matches the offset
    // `plugin-dev.runInDev` uses for the dev-test spawn.
    baseWindow: BaseWindowService,
  },
}) {
  async openPluginInNewWindow(args: {
    pluginName: string
    pluginDir: string
  }): Promise<{ windowId: string }> {
    const { workspaceId, scopeId } = await this.ensurePluginWorkspace(
      args.pluginName,
      args.pluginDir,
    )

    const newWindowId = nanoid()
    const activeView = {
      kind: "workspace" as const,
      workspaceId,
    }

    await this.ctx.db.client.update(root => {
      root.app.windowStates[newWindowId] = {
        selectedScopeId: scopeId,
        scopeLastTerminal: {},
        activeView,
        scopePanes: {},
        workspaceActiveScope: { [workspaceId]: scopeId },
        // Collapsed rail keeps the new window focused on plugin
        // editing; the user can pop it back with ⌘⇧B.
        workspaceRailOpen: false,
        workspaceUiStates: {},
        // Seed the active scope's right sidebar open with the
        // file-tree plugin selected.
        scopeUiStates: {
          [scopeId]: {
            rightSidebarWidth: null,
            terminalHeight: null,
            bottomPanelOpen: false,
            bottomPanelView: null,
            rightSidebarOpenType: "file-tree-sidebar",
            rightSidebarLastType: "file-tree-sidebar",
          },
        },
        pluginsView: { selectedPluginName: null, sidebarOpen: true },
        fullscreen: false,
      }
    })

    // Offset down-and-right from the parent's focused window so
    // the user sees a new window land instead of "the same window
    // blanked out". Falls through to Electron's default position
    // when no parent bounds are available (no main window yet,
    // headless tests, etc.).
    const parentBounds = this.ctx.baseWindow.windows
      .get("main")
      ?.getBounds()
    const offset = 48
    const offsetBaseWindow = parentBounds
      ? {
          x: parentBounds.x + offset,
          y: parentBounds.y + offset,
          width: parentBounds.width,
          height: parentBounds.height,
        }
      : {}

    return this.ctx.window.openView({
      type: "entrypoint",
      windowId: newWindowId,
      query: { skeletonRoute: skeletonRouteForActiveView(activeView) },
      baseWindow: {
        minWidth: 430,
        minHeight: 310,
        trafficLightPosition: { x: 14, y: 12 },
        ...offsetBaseWindow,
      },
      contextMenu: { prepend: buildContextMenuPrepend() },
    })
  }

  /**
   * Find (or create) the `kind: "plugin"` workspace whose anchor
   * scope points at `pluginDir`. Lookup key is `scope.pluginName`
   * — we match on the plugin id, not on the directory path, so
   * moving a plugin on disk doesn't fork its workspace.
   */
  private async ensurePluginWorkspace(
    pluginName: string,
    pluginDir: string,
  ): Promise<{ workspaceId: string; scopeId: string }> {
    const snapshot = this.ctx.db.client.readRoot()

    const existingScope = Object.values(snapshot.app.scopes).find(s => {
      if (s.archived) return false
      if (s.pluginName === pluginName) return true
      if (s.directory === pluginDir) {
        const ws = snapshot.app.workspaces[s.workspaceId]
        if (ws && ws.kind === "plugin") return true
      }
      return false
    })
    if (existingScope) {
      return {
        workspaceId: existingScope.workspaceId,
        scopeId: existingScope.id,
      }
    }

    const { repoId } = await this.ctx.repos
      .detectAndSync({ directory: pluginDir })
      .catch(err => {
        console.warn(
          "[plugin-window] repos.detectAndSync failed:",
          err,
        )
        return { repoId: null as string | null }
      })

    const workspaceId = nanoid()
    const scopeId = nanoid()
    const now = Date.now()

    await this.ctx.db.client.update(root => {
      root.app.workspaces[workspaceId] = {
        id: workspaceId,
        name: pluginName,
        createdAt: now,
        icon: null,
        iconAuto: null,
        iconAutoAttempted: true,
        archived: false,
        kind: "plugin",
        defaultWorktreeBranch: null,
      }
      root.app.scopes[scopeId] = {
        id: scopeId,
        workspaceId,
        directory: pluginDir,
        repoId,
        extraDirectories: [],
        createdAt: now,
        archived: false,
        archivedAt: null,
        pinnedAt: now,
        unpinnedAt: null,
        pluginName,
      }
    })

    return { workspaceId, scopeId }
  }
}
