import { Service } from "@zenbujs/core/runtime"
import { RpcService } from "@zenbujs/core/services"

/**
 * Registers the agent-sidebar's command-palette actions.
 *
 * Currently exposes "Import Worktrees\u2026" \u2014 previously a dropdown
 * item on the New Chat split button. The action lives in the
 * palette so it stays discoverable without cluttering the
 * always-visible sidebar header. Two-step dispatch:
 *
 *   1. The renderer invokes `importWorktrees({ windowId })` via
 *      the palette's generic RPC bridge.
 *   2. We emit `events.agentSidebar.importWorktrees({ windowId })`
 *      so the agent-sidebar view in *that* window can run the
 *      renderer-side import (which depends on the active
 *      workspace + repo derived from the window's state).
 *
 * Same pattern as `searchRecentWorkspaces.togglePalette`.
 */
export class AgentSidebarActionsService extends Service.create({
  key: "agentSidebarActions",
  deps: {
    rpc: RpcService,
    paletteActions: "paletteActions",
  },
}) {
  evaluate() {
    this.setup("register-palette-action", () => {
      const reg = this.ctx.paletteActions as {
        register: (spec: unknown) => Promise<unknown>
        unregister: (a: { id: string }) => Promise<unknown>
      }
      const id = "agentSidebar.importWorktrees"
      void reg.register({
        id,
        label: "Import Worktrees\u2026",
        hint: "worktree",
        group: "Worktree",
        rpc: {
          plugin: "agentSidebar",
          service: "agentSidebarActions",
          method: "importWorktrees",
        },
      })
      return () => {
        void reg.unregister({ id })
      }
    })
  }

  /**
   * Palette dispatch entry-point. The renderer always passes
   * `{ windowId }`; we forward through the event bus so the
   * matching window's sidebar view handles the actual import
   * against its live workspace state.
   */
  async importWorktrees(args: { windowId: string }): Promise<{ ok: true }> {
    this.ctx.rpc.emit.agentSidebar.importWorktrees({
      windowId: args.windowId,
      source: "palette",
    })
    return { ok: true }
  }
}
