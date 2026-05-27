import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { Service } from "@zenbujs/core/runtime"
import { RpcService, ViewRegistryService } from "@zenbujs/core/services"

const here = path.dirname(fileURLToPath(import.meta.url))

const SIDEBAR_VIEW_SOURCE = path.resolve(
  here,
  "../../views/marketplace-sidebar-view.tsx",
)
const DETAIL_VIEW_SOURCE = path.resolve(
  here,
  "../../views/plugin-detail-view.tsx",
)

const SIDEBAR_VIEW_TYPE = "marketplace"
const DETAIL_VIEW_TYPE = "plugin-detail"

/**
 * Marketplace plugin service.
 *
 * Replaces the old full-pane marketplace view with a VS Code-style
 * pair of views:
 *
 *  - `marketplace` (`kind: "left-sidebar"`): a narrow sidebar tab
 *    contributed to the host's left-sidebar tab strip. Renders a
 *    search input + filtered list of mock plugins. Clicking a row
 *    calls `openDetailInPane` on this service, which fires the
 *    host's generic `openViewInActivePane` event to open the
 *    detail tab in the active pane.
 *  - `plugin-detail` (`kind: "embed"`): the per-plugin detail
 *    view. Mounted into a pane tab by the host whenever the
 *    `openViewInActivePane` event lands. `kind: "embed"` keeps
 *    it out of the command palette (it requires `pluginId` args
 *    to be meaningful).
 *
 * Workspace-rail button / plugins-root view are no longer
 * registered — the left-sidebar tab is the only entry point now.
 */
export class MarketplaceService extends Service.create({
  key: "marketplace",
  deps: {
    viewRegistry: ViewRegistryService,
    rpc: RpcService,
  },
}) {
  evaluate() {
    this.setup("register-sidebar-view", () => {
      void this.ctx.viewRegistry.registerView({
        type: SIDEBAR_VIEW_TYPE,
        rendering: "component",
        source: { modulePath: SIDEBAR_VIEW_SOURCE },
        meta: {
          kind: "left-sidebar",
          label: "Marketplace",
          // Sits after the agent (10) and extra-dirs (20) tabs.
          // Multiples of 10 leave room for other plugins to slot
          // between.
          order: 30,
          // Auto-registered shortcut for opening this tab (see
          // SidebarViewShortcutsService). Matches VS Code's
          // Extensions panel shortcut (⌘⇧X).
          shortcut: { mod: true, shift: true, key: "x" },
        },
      })
      return () => {
        void this.ctx.viewRegistry.unregisterView(SIDEBAR_VIEW_TYPE)
      }
    })

    this.setup("register-detail-view", () => {
      void this.ctx.viewRegistry.registerView({
        type: DETAIL_VIEW_TYPE,
        rendering: "component",
        source: { modulePath: DETAIL_VIEW_SOURCE },
        // `kind: "embed"` matches the convention used by other
        // arg-driven pane views (e.g. `plan`): hidden from the
        // command palette, reached only via
        // `openViewInActivePane`.
        meta: { kind: "embed", label: "Plugin" },
      })
      return () => {
        void this.ctx.viewRegistry.unregisterView(DETAIL_VIEW_TYPE)
      }
    })
  }

  /**
   * Called from the marketplace sidebar when the user clicks a
   * plugin row. Fires the host's generic `openViewInActivePane`
   * event with a *shared* `source` token (`"marketplace"`), not
   * one keyed per plugin id.
   *
   * Same pattern as the file-tree sidebar: the first click spawns
   * a new pane, and every subsequent click finds the same tab
   * (matched on `source`) and replaces its content. End result is
   * exactly one "Marketplace detail" tab per scope, navigating in
   * place as the user clicks through plugins.
   *
   * `placement: "left"` puts that new pane to the *left* of the
   * active chat / view pane instead of the default "right of
   * active". The marketplace tab lives in the left sidebar, so
   * clicks naturally flow left-to-right — detail card on the
   * inside (next to the sidebar), the user's existing work
   * remains visible to its right.
   */
  async openDetailInPane(args: { pluginId: string }): Promise<{ ok: true }> {
    this.ctx.rpc.emit.app.openViewInActivePane({
      viewType: DETAIL_VIEW_TYPE,
      source: "marketplace",
      args: { pluginId: args.pluginId },
      placement: "left",
    })
    return { ok: true }
  }

  /**
   * Read an installed plugin's `README.md` + `package.json` for
   * the detail view.
   *
   * We do this in the marketplace service rather than reusing
   * `rpc.app.fileTree.readFile` because `readFile` throws on
   * `ENOENT` — a missing README is the common case (most
   * plugins don't ship one), but it's still surfaced as a
   * `[zenrpc] method execution failed` error log on the main
   * process. Doing the read here lets us treat "file not found"
   * as a normal `null` return instead of an exception, keeping
   * the logs clean.
   *
   * Returns whatever it could find. Either field can be `null`
   * independently:
   *   - `readme: null` — no README.md, or it was binary.
   *   - `pkg: null`    — no package.json, or it was unparseable.
   *
   * Other I/O errors (permission denied, etc.) still throw so
   * they're not silently swallowed.
   */
  async readPluginDetail(args: { directory: string }): Promise<{
    readme: string | null
    pkg: {
      version: string | null
      description: string | null
      author: string | null
    } | null
  }> {
    const readme = await readOptional(
      path.join(args.directory, "README.md"),
    )
    const pkgRaw = await readOptional(
      path.join(args.directory, "package.json"),
    )
    let pkg: {
      version: string | null
      description: string | null
      author: string | null
    } | null = null
    if (pkgRaw != null) {
      try {
        const parsed = JSON.parse(pkgRaw) as Record<string, unknown>
        pkg = {
          version:
            typeof parsed.version === "string" ? parsed.version : null,
          description:
            typeof parsed.description === "string"
              ? parsed.description
              : null,
          author: extractAuthor(parsed.author),
        }
      } catch {
        // Malformed package.json — treat as "no metadata". The
        // detail header still renders without it.
        pkg = null
      }
    }
    return { readme, pkg }
  }
}

/**
 * `fs.readFile`, but returns `null` on `ENOENT` / `ENOTDIR`
 * instead of throwing. Everything else propagates. Used by
 * `readPluginDetail` so a missing README / package.json doesn't
 * end up in the `[zenrpc] method execution failed` log.
 */
async function readOptional(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf-8")
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === "ENOENT" || code === "ENOTDIR" || code === "EISDIR") {
      return null
    }
    throw err
  }
}

function extractAuthor(raw: unknown): string | null {
  if (typeof raw === "string") return raw
  if (raw && typeof raw === "object") {
    const name = (raw as { name?: unknown }).name
    if (typeof name === "string") return name
  }
  return null
}
