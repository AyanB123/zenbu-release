import { Service } from "@zenbujs/core/runtime"
import {
  RpcService,
} from "@zenbujs/core/services"

/**
 * Registers the `"tool-output"` embed view and exposes a single RPC
 * (`openOutput`) that re-emits `openToolOutputInActivePane` so the
 * main shell can land the view in a side pane next to the chat.
 *
 * This is the chat-side counterpart of `FileTreeService` / `GitTreeService`:
 * a click on a tool-call preview (BashCard today, more cards later)
 * routes through here, exactly the way clicking a file in the file
 * sidebar routes through `fileTree.openFile`. Same source-token
 * dance (`"chat-tool-output"` on the renderer side) gives us "one
 * shared output pane that any tool click replaces" semantics for
 * free — no new pane plumbing.
 *
 * `tool-output` view is `meta.kind: "embed"`: it needs args
 * (`{ sessionId, toolCallId }`) to be meaningful, so we hide it
 * from the command palette while still letting other services /
 * event handlers open it via `useOpenView` / `openViewBySource…`.
 */
export class ToolOutputService extends Service.create({
  key: "toolOutput",
  deps: {
    // Needed so we can emit `openToolOutputInActivePane`.
    rpc: RpcService,
    // vite server to already be live.
  },
}) {
  evaluate() {
    this.setup("register-view", () =>
      this.inject({
        name: "tool-output",
        modulePath: "src/renderer/views/tool-output/tool-output-app.tsx",
        exportName: "ToolOutputApp",
        meta: { kind: "embed", label: "Tool Output" },
      }),
    )
  }

  /** Called by a tool-call card (chat surface) when the user clicks
   * its preview. Re-broadcasts as `openToolOutputInActivePane` so the
   * main shell (which owns the pane layout) can split off / reuse a
   * pane with the `tool-output` view in it. Mirrors
   * `GitTreeService.openDiff`.
   *
   * Caller is responsible for passing the originating chat's
   * `workspaceId + scopeId`. Without them the shell would fall back
   * to the window's currently-active workspace and the side pane
   * could end up in the wrong place — the same bug `openDiff`
   * already guards against. */
  async openOutput(args: {
    workspaceId: string
    scopeId: string
    sessionId: string
    toolCallId: string
  }): Promise<{ ok: true }> {
    this.ctx.rpc.emit.app.openToolOutputInActivePane({
      workspaceId: args.workspaceId,
      scopeId: args.scopeId,
      sessionId: args.sessionId,
      toolCallId: args.toolCallId,
    })
    return { ok: true }
  }
}
