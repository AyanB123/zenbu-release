import { Service } from "@zenbujs/core/runtime"
import { RpcService, ShortcutsService } from "@zenbujs/core/services"

const IS_MAC = process.platform === "darwin"

/**
 * Owns the Cmd+; recent-worktrees palette.
 *
 * Pure UI service: no schema, no db writes. The palette derives
 * worktree recency on the fly from `session.lastOpenedAt` (already
 * stamped by the host's `SessionActivityService`), so selecting a
 * worktree shares a code path with clicking a chat in the agent
 * sidebar.
 *
 * Registers a `searchRecentWorktrees` shortcut (Cmd+; by default)
 * and a matching command-palette action; both dispatch the same
 * `togglePalette` event the content-script-mounted palette
 * subscribes to.
 */
export class SearchRecentWorktreesService extends Service.create({
  key: "searchRecentWorktrees",
  deps: {
    rpc: RpcService,
    shortcuts: ShortcutsService,
    paletteActions: "paletteActions",
  },
}) {
  evaluate() {
    this.setup("register-shortcut", () =>
      this.ctx.shortcuts.register({
        id: "searchRecentWorktrees.togglePalette",
        name: "Toggle Recent Worktrees Palette",
        category: "Navigation",
        description:
          "Open the recent-worktrees palette \u2014 a focused fuzzy picker that jumps between worktrees by most-recently-opened chat.",
        defaultBinding: IS_MAC
          ? { meta: true, key: ";" }
          : { control: true, key: ";" },
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
      const id = "searchRecentWorktrees.togglePalette"
      // No `icon` — the palette is label-only. Keep `hint` purely
      // for the fuzzy-filter index (e.g. typing "\u2318;" still
      // finds this row).
      void reg.register({
        id,
        label: "Recent Worktrees\u2026",
        hint: IS_MAC ? "\u2318;" : "Ctrl+;",
        group: "Navigation",
        rpc: {
          plugin: "searchRecentWorktrees",
          service: "searchRecentWorktrees",
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
        modulePath: "src/content/recent-worktrees-palette.tsx",
      }),
    )
  }

  /** Palette-action RPC handler. Forwarded to the same event the
   * shortcut emits so both surfaces hit one renderer code path. */
  async togglePalette(_args: { windowId: string }): Promise<{ ok: true }> {
    this.emitToggle("palette")
    return { ok: true }
  }

  private emitToggle(source: string) {
    this.ctx.rpc.emit.searchRecentWorktrees.togglePalette({ source })
  }
}
