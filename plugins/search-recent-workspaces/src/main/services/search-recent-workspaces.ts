import { Service } from "@zenbujs/core/runtime"
import {
  DbService,
  RpcService,
  ShortcutsService,
} from "@zenbujs/core/services"

const IS_MAC = process.platform === "darwin"

/**
 * Owns the Cmd+L recent-workspaces palette.
 *
 * Two responsibilities:
 *
 *  1. **Recency stamping.** Subscribes to `app.windowStates` and
 *     tracks each window's last-known active workspace id. When a
 *     window transitions to a different workspace (including from
 *     null on boot), the new workspace's id gets a `Date.now()`
 *     stamp in our own `lastVisitedAt` record. Writes to our own
 *     schema field don't trigger the watcher because we subscribe
 *     to `app.windowStates` specifically, so there's no feedback
 *     loop.
 *
 *  2. **Palette shell.** Registers a `searchRecentWorkspaces`
 *     shortcut (Cmd+L by default) and a matching command-palette
 *     action; both dispatch the same `togglePalette` event. The
 *     content-script-mounted palette subscribes and toggles its
 *     open state — same pattern as `pluginInstaller` /
 *     `searchRecentAgents`.
 */
export class SearchRecentWorkspacesService extends Service.create({
  key: "searchRecentWorkspaces",
  deps: {
    db: DbService,
    rpc: RpcService,
    shortcuts: ShortcutsService,
    paletteActions: "paletteActions",
  },
}) {
  /** windowId → last-known active workspaceId (or null when the
   * window isn't on a workspace, e.g. onboarding / view). */
  private readonly prevActive = new Map<string, string | null>()

  evaluate() {
    // --- recency stamping --------------------------------------------------
    this.setup("watch-window-states", () => {
      // Seed `prevActive` from the snapshot so the first real
      // transition we observe is genuinely a transition. Without
      // this, we'd stamp every workspace currently active in any
      // window the moment the service starts.
      this.seed()
      const off = this.ctx.db.client.app.windowStates.subscribe(() => {
        this.recompute()
      })
      return () => off()
    })

    // --- palette toggle: shortcut + palette action ------------------------
    this.setup("register-shortcut", () =>
      this.ctx.shortcuts.register({
        id: "searchRecentWorkspaces.togglePalette",
        name: "Toggle Recent Workspaces Palette",
        category: "Navigation",
        description:
          "Open the recent-workspaces palette \u2014 a focused fuzzy picker that jumps between workspaces by last-visited time.",
        defaultBinding: IS_MAC
          ? { meta: true, key: "l" }
          : { control: true, key: "l" },
        handler: () => {
          this.emitToggle("shortcut")
        },
      }),
    )

    this.setup("register-palette-action", () => {
      const reg = this.ctx.paletteActions as {
        register: (spec: unknown) => Promise<unknown>
        unregister: (a: { id: string }) => Promise<unknown>
      }
      const id = "searchRecentWorkspaces.togglePalette"
      // No `icon` field — the palette is label-only. Keep `hint` so
      // "\u2318L" still indexes the fuzzy filter even though it's
      // never rendered.
      void reg.register({
        id,
        label: "Recent Workspaces\u2026",
        hint: IS_MAC ? "\u2318L" : "Ctrl+L",
        group: "Navigation",
        rpc: {
          plugin: "searchRecentWorkspaces",
          service: "searchRecentWorkspaces",
          method: "togglePalette",
        },
      })
      return () => {
        void reg.unregister({ id })
      }
    })

    this.setup("inject-palette", () =>
      this.injectContentScript({
        view: "entrypoint",
        modulePath: "src/content/recent-workspaces-palette.tsx",
      }),
    )
  }

  /** Palette-action RPC handler. Forwarded to the same event the
   * shortcut emits so both surfaces hit one renderer code path. */
  async togglePalette(_args: { windowId: string }): Promise<{ ok: true }> {
    this.emitToggle("palette")
    return { ok: true }
  }

  // ---- internals ---------------------------------------------------

  private emitToggle(source: string) {
    this.ctx.rpc.emit.searchRecentWorkspaces.togglePalette({ source })
  }

  private seed(): void {
    const root = this.ctx.db.client.readRoot()
    for (const [windowId, ws] of Object.entries(root.app.windowStates ?? {})) {
      this.prevActive.set(windowId, activeWorkspaceIdOf(ws))
    }
  }

  private recompute(): void {
    const root = this.ctx.db.client.readRoot()
    const stamps: string[] = []
    const live = new Set<string>()
    for (const [windowId, ws] of Object.entries(root.app.windowStates ?? {})) {
      live.add(windowId)
      const wsId = activeWorkspaceIdOf(ws)
      const prev = this.prevActive.get(windowId) ?? null
      if (wsId && wsId !== prev) stamps.push(wsId)
      this.prevActive.set(windowId, wsId)
    }
    // Clean up windows that no longer exist so the map doesn't
    // leak across long-running sessions with transient windows.
    for (const k of [...this.prevActive.keys()]) {
      if (!live.has(k)) this.prevActive.delete(k)
    }
    if (stamps.length === 0) return
    const now = Date.now()
    void this.ctx.db.client
      .update((root) => {
        for (const wsId of stamps) {
          if (!root.app.workspaces[wsId]) continue
          root.searchRecentWorkspaces.lastVisitedAt[wsId] = now
        }
      })
      .catch((err) =>
        console.warn(
          "[search-recent-workspaces] failed to stamp lastVisitedAt:",
          err,
        ),
      )
  }
}

// Local copy of the host's `activeWorkspaceIdOf` selector — kept
// inline to avoid pulling a renderer-side util into a main-process
// service.
function activeWorkspaceIdOf(
  ws: { activeView?: { kind: string; workspaceId?: string } } | undefined,
): string | null {
  if (!ws) return null
  const av = ws.activeView
  if (!av || av.kind !== "workspace") return null
  return av.workspaceId ?? null
}
