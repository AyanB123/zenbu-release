# Plugin Authoring & Marketplace

How Zenbu plugins are structured, declared, wired into the host UI, enabled/disabled
at runtime, and distributed through the in-app marketplace and the Pi Packages
integration. Every claim is grounded in source under `plugins/`.

## Plugin structure

A plugin is a folder with a `zenbu.plugin.ts` manifest at its root (referenced from a
`zenbu.plugins*.jsonc` file, see below). The canonical first-party example is
`plugins/pi-commands`. Its manifest (`plugins/pi-commands/zenbu.plugin.ts`):

```ts
export default definePlugin({
  name: "piCommands",
  services: ["./src/main/services/*.ts"],
  schema: "./src/main/schema.ts",
  migrations: "./migrations",
  dependsOn: [
    { name: "app", from: "../../zenbu.config.ts" },
    { name: "settings", from: "../../zenbu.config.ts" },
  ],
})
```

The fields (all optional except `name`):

- **`services`** - globs of main-process service modules. Each exports a class built
  with `Service.create({ key, deps })` whose `evaluate()` runs once at boot and
  registers contributions (RPC handlers, advice, injections, db setup). `pi-commands`
  ships `PiCommandsService` (registers Pi slash commands + a Composer around-advice)
  and `PiSettingsSectionService` (injects a `"pi-settings"` view + a `"Pi"` settings
  section).
- **`schema` / `migrations`** - a `createSchema({...})` module defining the plugin's
  own DB section under `root.<pluginName>` plus migrations. `pi-commands` owns
  `root.piCommands.panels[composerId]` (per-composer panel state its advice reads via
  `useDb`). Keeping UI state in the plugin's own db section (not host props) is the
  recommended pattern.
- **`dependsOn`** - a `zen link` directive for typed access to another plugin's RPC,
  events, and DB sections. **Not** a runtime load-order constraint (see callout below).
- **`icons`** - map of injection-name -> inline SVG string for views this plugin
  contributes (see `plugins/app/zenbu.plugin.ts` for the lucide-envelope shape).
- **`events`** - typed event contract module (only `app` uses this today).

Two contribution primitives live inside services, not the manifest:

1. **Advice** (around/before/after) - wraps a host component. Registered via
   `this.advise({ moduleId, name, type, modulePath, exportName })` in `evaluate()`.
   `pi-commands`' `ComposerInputAdvice` (`src/content/composer-input-advice.tsx`)
   receives the original `Composer` + props, can short-circuit with its own panel JSX,
   or pass through while appending a CodeMirror extension to `props.codeMirrorExtensions`.
2. **Slash commands** - registered on the host `slashCommands` registry with an
   `rpc: { plugin, service, method }` triple; the dispatcher calls back into the
   plugin's service on invocation.

## Declaring plugins

Plugins are declared in JSONC manifest files, **not** in `zenbu.config.ts`.
`zenbu.config.ts` points the framework at them via `pluginsFiles`:

```ts
export default defineConfig({
  uiEntrypoint: "./plugins/app/src/renderer",
  pluginsFiles: ["./zenbu.plugins.jsonc", "./zenbu.plugins.local.jsonc"],
  // ...build config
})
```

Each manifest is an array of `{ path, enabled }` entries. From
`zenbu.plugins.jsonc`:

```jsonc
{
  "plugins": [
    { "path": "./plugins/app/zenbu.plugin.ts", "enabled": true },
    { "path": "./plugins/pi-commands/zenbu.plugin.ts", "enabled": true },
    { "path": "./plugins/plan/zenbu.plugin.ts", "enabled": true },
    // ...
    { "path": "./plugins/plugins/zenbu.plugin.ts", "enabled": true }
  ]
}
```

`zenbu.plugins.local.jsonc` is the machine-local overlay (absolute paths, dev-only
plugins) merged on top of the tracked manifest.

> ### Manifest-order contract (issue #4)
>
> **Plugins are evaluated in declaration order.** The framework walks the merged
> `plugins` array top-to-bottom when running each plugin's `evaluate()`, so a plugin
> that consumes another plugin's registered surface (RPC registry, injected views,
> settings sections, slash commands) must appear **after** the plugin that provides
> it in the manifest.
>
> `dependsOn` is a **type-only** directive used by `zen link` to emit typed
> `ctx.<name>` accessors and `root.<name>` DB sections - it does **not** reorder
> evaluation or guarantee runtime availability. This is why `plugins/plugins`
> (which calls `ctx.pluginInstaller` and registers against `app`'s settings
> registry) is listed after `app`, `pluginInstaller`, and `settings` in
> `zenbu.plugins.jsonc`, even though its `dependsOn` already names them.
>
> **Rule of thumb: declare dependencies ABOVE their dependents.** If a plugin's
> `evaluate()` reaches for a registry that hasn't been populated yet, the
> contribution silently no-ops or throws at boot.

The reverse is also observable: `plugins/app/zenbu.plugin.ts` declares a type-only
`dependsOn` on `agentSidebar` and `openProjects` (downstream plugins) purely so host
renderer code gets typed `root.agentSidebar.*` accessors - the comment in that file
confirms `dependsOn` "doesn't create a runtime load order," which is exactly why
manifest position is what matters.

## The injection system

Injections are the UI extension primitive. A plugin service calls `this.inject({...})`
inside `evaluate()` to contribute a named React component to a well-known slot in the
host shell. There is **no static `view` field on the plugin spec** - placement is
decoded entirely from the `meta.kind` of each injection plus the host's convention for
that slot.

From `plugins/plugins/src/main/services/marketplace.ts`:

```ts
this.setup("inject-sidebar-view", () =>
  this.inject({
    name: "marketplace",                              // unique injection key
    modulePath: "./src/views/marketplace-sidebar-view.tsx",
    meta: {
      kind: "left-sidebar",                           // slot convention
      label: "Plugins",
      order: 30,
      shortcut: { mod: true, shift: true, key: "x" },
    },
  }),
)

this.setup("inject-detail-view", () =>
  this.inject({
    name: "plugin-detail",
    modulePath: "./src/views/plugin-detail-view.tsx",
    meta: { kind: "embed", label: "Plugin" },
  }),
)
```

Observed `meta.kind` values and their host-side meaning:

- `"left-sidebar"` - a collapsible rail item in the host's left sidebar. The
  `marketplace` injection is how the Plugins tab appears; `order` controls position.
- `"view"` - a standalone component view, mountable in any pane or embedded via
  `<View name="..." />`. `pi-commands`' `"pi-settings"` view uses this kind.
- `"embed"` - a view meant for a specific pane context, addressed by name.
  `plugin-detail` is opened by the marketplace sidebar when a row is clicked.
- `"workspace-rail"` - a button in the per-workspace rail (see `settings`'s
  `"settings-rail-button"` view in `plugins/settings/zenbu.plugin.ts`).

The settings panel wires a view into a section via the registry's
`body: { kind: "view", viewType: <injection name> }` escape hatch. From
`pi-settings-section.ts`:

```ts
void this.ctx.settingsRegistry.registerSection({
  id: "pi",
  label: "Pi",
  order: 10,
  icon: PI_ICON_SVG,
  body: { kind: "view", viewType: "pi-settings" },   // mounts <View name="pi-settings" />
})
```

This is the canonical pattern for plugins that need bespoke settings UI: inject a
`"view"`-kind component, then register a settings section whose body points at that
view name. The settings panel reads `root.settings.registry.sections` and mounts the
matching view when the user selects the section.

## Enable/disable lifecycle

There are three independent enable flags, persisted differently:

**1. The marketplace plugin itself (`root.plugins.enabled`).**
`MarketplaceSettingsService.setEnabled` (in
`plugins/plugins/src/main/services/marketplace-settings.ts`) writes the boolean to the
db section and notifies the settings registry. When `false`, `refreshFeed()` becomes a
no-op and the sidebar injection's host-side gating hides the tab. This is a live UI
toggle - no restart required.

**2. Per-plugin enable state, owned by the framework's `PluginManagerService`.**
`MarketplaceService.setPluginEnabled` delegates straight through:

```ts
async setPluginEnabled(args: { pluginFile: string; enabled: boolean }) {
  await this.ctx.pluginManager.setEnabled({
    path: args.pluginFile,
    enabled: args.enabled,
  })
  return { ok: true }
}
```

The plugin manager rewrites the `enabled` flag on the plugin's manifest entry
(`zenbu.plugins.jsonc` or `zenbu.plugins.local.jsonc`) and the file watcher reloads
the affected plugin on the next evaluation cycle. In practice this means toggling a
plugin's enable state in the Plugins tab persists to disk and takes effect on reload;
the marketplace UI reflects the new state immediately from `root.app.plugins` (where
each row carries `name`, `dir`, `kind`, `enabled`, `pluginFile`).

**3. Pi packages (`root.plugins.piInstalled[*].enabled`).** Handled separately by
`PiPackagesService.setPiPackageEnabled`, which writes the enable/disable transform to
Pi's own settings files (`~/.pi/agent/settings.json` for `user` scope,
`.pi/settings.json` for `project`) via `SettingsManager`, stashing filter backups in
`root.plugins.piDisabledFilterBackups` so re-enabling restores the original
per-resource filters. See the next section.

## Pi Packages marketplace

`PiPackagesService` (`plugins/plugins/src/main/services/pi-packages.ts`) bridges
Zenbu's Plugins UI to Pi's package model (`@earendil-works/pi-coding-agent`). Pi
packages are distinct from Zenbu plugins: they are installed through Pi's own
settings/package manager, **not** through `zenbu.plugins.local.jsonc`. The schema
comment in `plugins/plugins/src/main/schema.ts` makes this explicit.

**Catalog.** A small static catalog (`PI_CATALOG`) is seeded into
`root.plugins.piCatalog` on every `evaluate()` via the `seed-pi-catalog` setup step.
Each `PiPackageListing` carries `source` (e.g. `npm:pi-subagents`), `installCommand`,
tags, and links. `listPiCatalog({ query })` filters the catalog in-memory.

**Installed sync.** `syncInstalled({ cwd })` is the source of truth for installed
state. It:

1. Builds a `SettingsManager` + `DefaultPackageManager` for the given cwd/agent dir.
2. Reads `packageManager.listConfiguredPackages()` (the configured sources, with scope).
3. Calls `packageManager.resolve(async () => "skip")` to enumerate the resolved
   `extensions | skills | prompts | themes` resources. The `"skip"` callback means
   missing packages are **not** auto-installed during a listing pass.
4. Builds one `PiInstalledPackage` per configured source, grouping resolved resources
   by `metadata.source` + `metadata.scope`, and writes the map (keyed
   `${scope}:${source}`) into `root.plugins.piInstalled`.

`syncInstalled` runs lazily - only on explicit RPC (`listInstalledPiPackages`,
`installPiPackage`, `setPiPackageEnabled`, `removePiPackage`, `updatePiPackage`) or
when a Pi UI view mounts and calls `useRefreshPiPackages()`. This deferral is
intentional to keep boot fast (Phase 3 of the stabilization plan).

**Install / remove / update.**

```ts
await installPiPackage({ source: "npm:pi-subagents", local: false })
//   -> packageManager.installAndPersist(source, { local }) + manager.flush()
await removePiPackage({ source, scope })
//   -> packageManager.removeAndPersist(source, { local: scope === "project" })
await updatePiPackage({ source })   // packageManager.update(source)
```

`normalizeSource` requires a `npm:` / `git:` / `file:` / local-path prefix and rejects
bare names.

**Enable/disable.** `setPiPackageEnabled` applies Pi's disable/filter transform
(`setPiPackageEnabledInList` from `lib/pi-package-settings.ts`) to the right scope's
package list, persists via the settings manager, and stashes/restores per-source
filter backups in `root.plugins.piDisabledFilterBackups` so toggling is reversible.

**Detail view.** `plugin-detail-view.tsx` detects Pi rows by parsing the detail id
(`parsePiPackageDetailId`): Pi ids are shaped `pi:<scope>:<encoded-source>` (with a
backward-compatible `pi:<source>` fallback). When a Pi source is present, the view
renders `PiPackageDetailPane` instead of the Zenbu-plugin body, showing metadata
(source, scope, state, path, diagnostics), a per-resource summary
(`PiPackageResourceSummary`) of `extensions`/`skills`/`prompts`/`themes` with
`enabled/total` counts, README + `package.json` (via `readPiPackageDetail`), and
actions: Enable/Disable, Update, Copy path/source, Uninstall (with confirm dialog).

**Marketplace sidebar.** `marketplace-sidebar-view.tsx` lists installed plugins,
installed Pi packages, the Pi catalog, and the browse feed in one filtered list,
delegating Pi mutations to the `usePiPackageActions()` hooks in
`lib/pi-package-store.ts` (which call the `piPackages` RPC surface).

**Schema.** `plugins/plugins/src/main/schema.ts` defines the persisted collections:
`piCatalog` (seeded catalog cache), `piInstalled` (installed state, keyed
`${scope}:${source}`), and `piDisabledFilterBackups` (reversible disable state). The
broader marketplace `feed` collection and Zenbu-plugin `catalog` live in the same
schema but are populated by `MarketplaceService` from the remote registry at
`https://zenbu-app.vercel.app`, not by the Pi service.
