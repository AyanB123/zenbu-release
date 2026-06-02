# Zenbu plugin authoring guide

Zenbu is a Zenbu.js app composed of the `app` plugin and a set of sibling plugins under `plugins/`.

## Framework

The plugin framework is Zenbu.js. Read its docs at <https://zenbulabs.mintlify.app> for `Service`, `definePlugin`, RPC, events, the replicated DB, and the injection primitive. Everything below references those APIs.

## Layout

```
plugins/
  app/                # the `app` plugin: workspace shell, schema, most events
  <name>/             # one folder per first-party plugin
packages/
  ui/                 # @zenbu/ui (shadcn primitives + list-nav)
  view-theme/         # @zenbu/view-theme (Tailwind tokens)
```

A plugin folder:

```
my-plugin/
  zenbu.plugin.ts
  src/main/services/my-plugin.ts
  src/main/schema.ts
  src/main/events.ts
  src/views/my-view.tsx
  migrations/
```

`zenbu.plugin.ts`:

```typescript
import { definePlugin } from "@zenbujs/core/config"

export default definePlugin({
  name: "myPlugin",
  services: ["./src/main/services/*.ts"],
  schema: "./src/main/schema.ts",
  events: "./src/main/events.ts",
  migrations: "./migrations",
  dependsOn: [{ name: "app", from: "../../zenbu.config.ts" }],
  icons: { "my-plugin": "<svg ...></svg>" },
})
```

`dependsOn` gives typed access to `db.app.*`, `rpc.app.*`, and `events.app.*`.

## How the app is structured

State for the workspace shell (sidebars, panes, tabs, terminal, palette state) lives in `db.app.*`, the section of the replicated database owned by the `app` plugin. The renderer reads `db.app` and renders. State changes propagate by mutating `db.app`; the replicated DB syncs to every renderer and the UI re-renders.

Plugins drive state changes by emitting events declared by the `app` plugin (`events.app.*`). The `app` plugin's renderer has subscribers that listen for each event and apply the matching DB mutation. For example, emitting `app.openViewInActivePane(...)` causes the `app` plugin's renderer to call `dbClient.update(root => openViewBySourceInRoot(root, ...))`, which updates `db.app.windowStates[windowId].panes`. The pane structure change syncs to every renderer and `<View>` re-renders.

`app` here is the namespace of the `app` plugin, set by `name: "app"` in `plugins/app/zenbu.plugin.ts`. The same namespace keys `db.app.*`, `events.app.*`, and `rpc.app.<service>.<method>`. A plugin you write uses its own `name` for its own DB section, events, and RPC.

A plugin extends the app three ways:

1. Fill a slot. Register an injection with a matching `meta.kind`. See [Slots](#slots).
2. Emit or subscribe to `events.app.*`. See [Events](#events).
3. Wrap an existing export with advice. See [Advice](#advice).

## Slots

A slot is code that calls `useInjections({ kind: "..." })` and uses the results. Fill one by registering an injection with the matching `kind`:

```typescript
this.setup("inject", () =>
  this.inject({
    name: "my-plugin",
    modulePath: "./src/views/my-view.tsx",
    meta: { kind: "left-sidebar", label: "My plugin", order: 50 },
  }),
)
```

The slots the `app` plugin exposes:

- **Left sidebar tab.** `kind: "left-sidebar"`. Value: React component. Args: none. `meta.shortcut: { mod?, shift?, alt?, key }` auto-binds an open shortcut. Pulls focus on `focusSidebar` (Cmd+0).
- **Right sidebar tab.** `kind: "right-sidebar"`. Same shape as left sidebar.
- **Workspace rail button.** `kind: "workspace-rail"`. Value: React component. Args: none. Small icon button in the rail footer; typically emits a host event on click.
- **Bottom panel tab.** `kind: "bottom-panel"`. Value: React component. Args: none. First registered is the default tab when a window has no saved selection.
- **Title bar item.** `kind: "title-bar"`. Value: React component. Args: `{ workspaceId, scopeId, directory }`. Render conditionally if `directory == null`.
- **Footer item.** `kind: "footer.item"`. Value: React component. Args: `{ sessionId }`. `meta.position: "left" | "right"` (default left). Registerable from a service or `useRegisterInjection`.
- **Composer extension (always).** `kind: "cm.composer-extension"`. Value: CodeMirror `Extension`. Applied to every composer including read-only renders of past messages.
- **Composer extension (editable).** `kind: "cm.composer-extension-editable"`. Same, applied only when the composer is editable. Use for keymaps, vim mode, paste handlers.
- **Pane view.** `kind: "view"`. Value: React component. Args: caller-supplied. Auto-adds three rows to the command palette: "Open in new tab", "Replace active pane", "Open in split".
- **Pane view (embed).** `kind: "embed"`. Same as pane view but hidden from the palette auto-add. Use when the view requires caller-supplied args (file path, diff target).

Conventional meta on all slots: `label` (display text), `icon` (inline SVG, auto-filled from the plugin's `icons:` map when the icon key matches the injection `name`), `order` (sort hint, ascending; use multiples of 10).

## Events

Each event is shown below as `app.<name>(payload)`. The `app.` prefix is the plugin namespace (see [How the app is structured](#how-the-app-is-structured)).

Emit and subscribe:

```typescript
// renderer
import { useEvents } from "@zenbujs/core/react"
const events = useEvents()
events.app.openViewInActivePane.emit({ viewType, source, args })
events.app.openSidebarView.subscribe(({ viewType, kind }) => { /* ... */ })

// main-process service (with `RpcService` as a dep)
this.ctx.rpc.emit.app.notify({ tone: "info", title: "hi" })
```

Shortcut bindings listed in parens fire the event automatically; emit it yourself to trigger the same action. Most events that mutate workspace state are picked up by the `app` plugin's renderer and applied as a `db.app.*` update.

Every payload carries a `source: string` for tracing. Pass your plugin's name, `"action"`, `"shortcut"`, or `"palette"`.

### Panes and tabs

A workspace can be split into multiple panes; each pane holds tabs (chat or view).

Open a view in its own pane:

- `app.openViewInActivePane({ viewType, source, args, placement?: "left" | "right" })`. The first emit with a given `source` opens a new pane next to the active one (default `placement: "right"`) and renders `<View name={viewType} args={args} />`. Subsequent emits with the same `source` reuse that pane's tab in place.

Typed helpers for the built-in embed views (same open-new-pane-or-reuse behavior, pre-shaped args):

- `app.openFileInActivePane({ directory, path })`. Opens the `file` embed view.
- `app.openDiffInActivePane({ workspaceId, scopeId, directory, path })`. Opens the `git-diff` embed view.
- `app.openToolOutputInActivePane({ workspaceId, scopeId, sessionId, toolCallId })`. Opens the `tool-output` embed view.
- `app.openPullRequestsView({ mode, prNumber, directory, openMode })`. Opens the PR pane view.

Split the active pane (chat content):

- `app.splitPaneSameSession` (Cmd+/). Duplicate the active chat into a new pane.
- `app.splitPaneNewChat` (Cmd+Shift+/). New chat in a new pane.

Tabs in the active pane:

- `app.newChatInCurrentPane` (Cmd+T). Add a new chat tab.
- `app.newChatReplaceActive` (Cmd+N). Replace the active tab.
- `app.navigateTabs({ dir })` (Cmd+Shift+[ / ]). Cycle. `dir: "prev" | "next"`.

Focus and close:

- `app.focusPane({ index })` (Cmd+1..9). Focus pane N (1-indexed). Auto-creates the pane if missing.
- `app.closeActivePane` (Cmd+W). Close the active pane. No-op on the last pane.

### Sidebars and rail

These fire on shortcuts and are emittable:

- `app.toggleSidebar` (Cmd+B). Show/hide the left sidebar.
- `app.toggleRightSidebar` (Cmd+G). Show/hide the right sidebar.
- `app.toggleWorkspaceRail` (Cmd+Shift+B). Show/hide the rail.
- `app.focusSidebar` (Cmd+0). Pull focus into the active left-sidebar view. Sidebar plugins subscribe to route focus into their `<ListNav>`.
- `app.openSidebarView({ viewType, kind })`. Opens the matching sidebar and selects `viewType`. If the view is already active, the sidebar closes. `kind: "left" | "right"`. Auto-fired by `meta.shortcut`.

### Composer

- `app.appendComposerDraft({ composerId, text })`. Append text to a draft. Active composer id at `root.app.windowStates[windowId].activeComposerId`.
- `app.focusActiveComposer` (Cmd+L). Pull focus into the composer of the active pane's chat.

### Terminal

Terminal shortcut events fire only while the terminal has focus (gated on `app.terminal` and `app.terminal.tabs` focus contexts):

- `app.toggleTerminal` (Cmd+J). Show/hide the bottom panel terminal.
- `app.terminalNew`. Create a new tab.
- `app.terminalFocusTabs`. Focus the tab strip.
- `app.terminalFocusActive`. Focus the active terminal.
- `app.terminalTabsMove({ dir })`. Step through tabs. `dir: "up" | "down"`.
- `app.terminalTabsActivate`. Activate the selected tab.
- `app.terminalTabsClose`. Close the selected tab.

Main pushes terminal I/O to the renderer (subscribe only):

- `app.terminalData({ terminalId, data, seq })`. Stdout chunk. `seq` dedupes on reconnect.
- `app.terminalExit({ terminalId, exitCode, signal })`. Process ended.

### Palettes

- `app.toggleCommandPalette` (Cmd+Shift+P). Show/hide the general palette.
- `app.toggleAgentsPalette` (Cmd+P). Show/hide the agents sub-palette.

### List navigation

Fired by `<ListNav>` (`@zenbu/ui/list-nav`). Subscribe and filter by your list's `scopeId`:

- `app.listNavMove({ scopeId, dir })`. J/k. `dir: "up" | "down"`.
- `app.listNavStep({ scopeId, dir })`. H/l. `dir: "in" | "out"`.
- `app.listNavPage({ scopeId, dir })`. Page up/down.
- `app.listNavActivate({ scopeId, alt })`. Space (`alt: false`) or Enter (`alt: true`). Branch on `alt` to differentiate "open" from "open in new tab".

### Settings

- `app.openSettings({ tab?, sectionId? })`. Opens the settings pane view. `tab: "general" | "accounts" | "shortcuts" | "plugins"`. `sectionId` deep-links inside `tab: "plugins"`.

### Notifications

- `app.notify({ tone, title, description? })`. Emit to show a toast. `tone: "error" | "success" | "info" | "warning"`. For long-running progress, define a domain-specific event in your plugin instead.

### Lifecycle

Subscribe to these to react to host actions:

- `app.agentCompletedUnviewed({ sessionId, chatId, label })`. A session finished while the user wasn't viewing it. The `app` plugin already renders a toast; don't double-fire `app.notify`.
- `app.createAppProgress({ runId, line, stream })` and `app.createAppDone({ runId, ok, error?, appPath? })`. `create-zenbu-app` output.
- `app.createPluginProgress({ runId, line, stream })` and `app.createPluginDone({ runId, ok, error?, pluginName?, pluginPath? })`. `create-zenbu-plugin` output. `pluginPath` is the absolute path of the scaffolded plugin.
- `app.pluginDevRunStart({ runId, pluginPath })`, `app.pluginDevRunError({ runId, pluginPath, message })`, `app.pluginDevRunExit({ runId, exitCode })`. `plugin-dev` "Run in Dev" child process events.
- `app.pluginDevInstallDone({ pluginPath, ok, error? })`. `plugin-dev` `installLocal` result.

## Command palette

Three sources fill the palette:

1. **Static commands** in `plugins/app/src/renderer/components/command-palette/commands.ts`. Not extensible.
2. **Plugin-registered actions** in `db.app.paletteActions`. Plugin services register and unregister entries.
3. **Auto-generated view actions.** Every `meta.kind: "view"` injection adds three rows ("Open in new tab", "Replace", "Split"). Use `meta.kind: "embed"` to opt out.

Register an action from a service. String-key the `paletteActions` dep because the runtime type lives in the `app` plugin:

```typescript
import { Service } from "@zenbujs/core/runtime"

export class MyPluginService extends Service.create({
  key: "myPlugin",
  deps: { paletteActions: "paletteActions" },
}) {
  evaluate() {
    this.setup("palette", () => {
      const reg = this.ctx.paletteActions as {
        register: (spec: unknown) => Promise<unknown>
        unregister: (a: { id: string }) => Promise<unknown>
      }
      void reg.register({
        id: "myPlugin.run",
        label: "My plugin: Run",
        rpc: { plugin: "myPlugin", service: "myPlugin", method: "run" },
        args: { mode: "fast" }, // optional; renderer also passes { windowId }
      })
      return () => { void reg.unregister({ id: "myPlugin.run" }) }
    })
  }

  async run(args: { windowId: string; mode: "fast" | "slow" }) {
    // do the thing
  }
}
```

The renderer always passes `{ windowId }`, merged with any fixed `args`. Return values are ignored.

## Advice

Wrap or replace an exported function or component anywhere in the app. The wrapper module's path is plugin-relative.

```typescript
this.setup("wrap-composer", () =>
  this.advise({
    moduleId: "composer.tsx",
    name: "Composer",
    type: "around",
    modulePath: "./src/wrap-composer.tsx",
  }),
)
```

```tsx
// ./src/wrap-composer.tsx
import type { ComponentType } from "react"

export default function WrapComposer<P>(Original: ComponentType<P>, props: P) {
  return <div className="bordered"><Original {...props} /></div>
}
```

`type` is one of `replace`, `around`, `before`, `after`. Around-advice receives the next function in the chain as its first argument (for components: `(Original, props)`). Full reference in the Zenbu.js advice docs.

## Built-in plugins

Reference list. Read the matching folder when you build something similar.

- `app`. `app` plugin. Workspace shell, schema, most events, command palette, shortcuts service.
- `agent-sidebar`. Left sidebar, chat list.
- `context-sidebar`. Right sidebar, context surface.
- `file-tree-sidebar`. Right sidebar, file tree. Emits `openFileInActivePane`.
- `git-tree-sidebar`. Right sidebar, git tree. Emits `openDiffInActivePane`.
- `marketplace`. Left sidebar, plugin marketplace.
- `settings`. Workspace rail gear + settings pane view + per-plugin section registry.
- `terminal`. Bottom panel, PTY terminal.
- `plan`. Slash command + pane view for the planning loop. Advice on the `ToolCall` chat component.
- `pi-footer`. Footer items: model picker, agent status.
- `pi-commands`. Slash commands bridging to host actions. Advice on the composer input.
- `cm-vim`. Composer extension (editable) + footer status badge.
- `cm-markdown`. Composer extension (always).
- `cm-image-paste`. Composer extension (editable).
- `open-in`. Title bar "Open in..." menu.
- `auto-updater`. Title bar update banner.
- `plugin-dev`. Title bar "Run in Dev" button.
- `plugin-installer`. Marketplace install flow.
- `search-recent-agents`, `search-recent-workspaces`, `search-recent-worktrees`. Palette sub-palettes.

## Conventions

- Injection names are global. Prefix with your plugin name (`"my-plugin/footer"`).
- `meta.order`: multiples of 10.
- `icons:` on `zenbu.plugin.ts` keyed by injection `name`. Per-plugin only; no cross-plugin fallback.
- DB section name matches the plugin `name` (camelCase). Don't write to `db.app.*` from another plugin.
- Run `pnpm run db:generate` after schema changes. Migration files go in `<plugin>/migrations/`.
- Shared peers (`react`, `react-dom`, `@zenbujs/core`, `@zenbu/ui`) are provided by the runtime. Do not bundle them.

## See also

- Zenbu.js: <https://zenbulabs.mintlify.app>
- PI (the coding agent): `plugins/app/docs/pi/`
- CodeMirror 6: <https://codemirror.net/docs/>
- Vite: <https://vitejs.dev/guide/>
- React: <https://react.dev>
- Electron: <https://www.electronjs.org/docs/latest/>
