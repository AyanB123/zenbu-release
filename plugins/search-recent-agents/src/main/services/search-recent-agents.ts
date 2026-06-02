import { Service } from "@zenbujs/core/runtime"

/**
 * Owns the Cmd+P "recent agents" palette.
 *
 * The host app already binds Cmd+P → `events.app.toggleAgentsPalette`
 * and mounts an `<AgentsPalette />` overlay in the renderer. We don't
 * want that overlay — we want our own VS-Code-style recent-agents
 * picker — so we use `replace` advice to swap the host's component
 * for our renderer module. The shortcut + event continue to drive
 * the same toggle.
 *
 * That gives us, on net:
 *   - the host's Cmd+P palette is gone (replaced).
 *   - our palette is mounted via the host's <Suspense> in app.tsx.
 *   - we reuse the host's `toggleAgentsPalette` event with no extra
 *     shortcut plumbing.
 */
export class SearchRecentAgentsService extends Service.create({
  key: "search-recent-agents",
}) {
  evaluate() {
    this.setup("replace-agents-palette", () =>
      this.advise({
        moduleId: "components/command-palette/agents-palette.tsx",
        name: "AgentsPalette",
        type: "replace",
        modulePath: "src/content/recent-agents-palette.tsx",
        exportName: "RecentAgentsPalette",
      }),
    )
  }
}
