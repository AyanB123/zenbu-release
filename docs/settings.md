# Zenbu Settings

Reference for the settings Zenbu actually reads at runtime. Every entry below is
sourced from code; the originating file is cited where the behavior is non-obvious.

## Environment variables

All `ZENBU_*` variables are optional. "Patch" in the Source column means the
variable is read inside `patches/@zenbujs__core@0.4.4.patch` (Zenbu's fork of
`@zenbujs/core`); "Source" means first-party TypeScript.

| Name | Default | Description | Source |
| --- | --- | --- | --- |
| `ZENBU_ADVICE_ROOT` | _set at boot to project root_ | Root path passed to the main-process advice/wrap system. Set internally during setup-gate; not meant to be user-set. | Patch |
| `ZENBU_AUTO_QUIT_AFTER_IDLE_MS` | _(unset; no auto-quit)_ | If set, the app calls `app.quit()` after this many idle ms. Used by the startup probe. | Patch |
| `ZENBU_CDP_PORT` | `9222` | Chrome DevTools Protocol port for the debug launcher (`scripts/debug/zenbu_debug_tool.py`). Set to enable remote CDP inspection of the renderer. | Debug |
| `ZENBU_TRACE_PLUGIN_IMPORTS` | _(unset)_ | When `1`, collect high-detail plugin/service import spans in the boot trace. | Debug |
| `ZENBU_BOOT_TRACE` | _(unset; off)_ | When `1`, writes a boot trace to `traces/boot/latest.json`. | Patch / `AGENTS.md` |
| `ZENBU_DISABLE_DYNOHOT` | _(unset; HMR on)_ | When `1`, skips registering `@zenbujs/hmr` (dynohot) so module hot-reload is disabled. Set by `launch-debug-windows.ps1` when HMR is off. | Patch |
| `ZENBU_ENABLE_MAIN_ADVICE` | _(unset; off)_ | When `1`, imports and registers main-process advice. Off by default. | Patch |
| `ZENBU_FILE_TREE_TRACE` | _(unset; off)_ | When `1`, emits `[fileTree-trace]` logs from the file-tree watcher/indexer. | `plugins/app/src/main/services/file-tree.ts` |
| `ZENBU_LINK_ON_BOOT` | _(unset; skip)_ | When `1`, runs `linkProject` during setup-gate. Without it, boot records `linkProject:skipped`. | Patch |
| `ZENBU_MARKETPLACE_URL` | `https://zenbu-app.vercel.app` | Base URL for the plugin marketplace API. | `plugins/plugins/src/main/services/marketplace.ts` |
| `ZENBU_SETUP_SHUTDOWN_TIMEOUT_MS` | `8000` | Max ms to wait for setup-gate shutdown work (e.g. `viteServer.close()`). Invalid/non-positive values fall back to the default. | Patch |
| `ZENBU_SKIP_CACHE_REPAIR` | _(unset; repair runs)_ | When `1`, skips the disposable Chromium cache repair step (`GPUCache`, `Code Cache`, etc.) that runs on startup. | Patch |
| `ZENBU_SOURCE_DIR` | _(unset; walks up from module)_ | Explicit absolute path to the Zenbu source tree. Used by `playground.ts` and `zenbu-house-rules.ts` to locate shipped assets (e.g. the app icon) when the running module is in a build. | `plugins/app/src/main/services/playground.ts`, `plugins/app/src/main/pi-extensions/zenbu-house-rules.ts` |

`NODE_ENV` and `ELECTRON_*` variables are not read by Zenbu's own source.
Standard Electron/Node conventions still apply to the underlying runtime.

## zenbu.config.ts

Root build/runtime config consumed by `@zenbujs/core/config` via `defineConfig`.
Field shape mirrors `zenbu.config.ts` at the repo root.

| Field | Type | Description |
| --- | --- | --- |
| `uiEntrypoint` | `string` | Path to the renderer entry (e.g. `"./plugins/app/src/renderer"`). |
| `pluginsFiles` | `string[]` | Plugin manifest files loaded at boot. Defaults to `["./zenbu.plugins.jsonc", "./zenbu.plugins.local.jsonc"]`. |
| `build` | `BuildConfig` (via `defineBuildConfig`) | Build/release configuration. See below. |

### `build` (from `defineBuildConfig`)

| Field | Type | Description |
| --- | --- | --- |
| `build.packageManager` | `{ type: "pnpm" \| ...; version: string }` | Package manager pinned into the source build. Currently `{ type: "pnpm", version: "10.13.1" }`. |
| `build.out` | `string` | Output directory for the source build (`.zenbu/build/source`). |
| `build.include` | `string[]` | Glob list of files/dirs shipped in the source build (per-plugin `src/**`, `migrations/**`, `zenbu.plugin.ts`, etc.). |
| `build.ignore` | `string[]` | Glob list excluded from the build (`*.test.ts`, `node_modules/**`, `dist/**`, `.env*`, `traces/**`, ...). |
| `build.plugins` | `BuildPlugin[]` | Transform plugins applied during the build. Zenbu ships `trimPackageJson`, which strips `pnpm.overrides` and selected `scripts` from `package.json`. `BuildPlugin` is `{ name: string; transform(file): string \| undefined }`. |
| `build.mirror` | `{ target: string; branch: string }` | Release mirror target. Currently `{ target: "zenbu-labs/zenbu-release", branch: "main" }`. |

## Pi settings

Pi-specific settings are contributed by the `pi-commands` plugin. They are
dynamic per-cwd and read from the underlying `pi` `SettingsManager`, so they do
**not** appear in `zenbu.config.ts` or in the static `settingsRegistry` item
model. Instead the `pi-commands` plugin registers a settings section with
`body: { kind: "view", viewType: "pi-settings" }` whose React component owns the
UI (`pi-settings-section.ts`).

The full set of items surfaced by `buildSettingsItems` in
`plugins/pi-commands/src/main/services/pi-commands.ts`:

| Item id | Label | Allowed values |
| --- | --- | --- |
| `autocompact` | Auto-compact | `true` / `false` |
| `show-images` | Show images | `true` / `false` |
| `image-width-cells` | Image width | `60`, `80`, `120` |
| `auto-resize-images` | Auto-resize images | `true` / `false` |
| `block-images` | Block images | `true` / `false` |
| `skill-commands` | Skill commands | `true` / `false` |
| `show-hardware-cursor` | Show hardware cursor | `true` / `false` |
| `editor-padding` | Editor padding | `0`, `1`, `2`, `3` |
| `autocomplete-max-visible` | Autocomplete max items | `3`, `5`, `7`, `10`, `15`, `20` |
| `clear-on-shrink` | Clear on shrink | `true` / `false` |
| `terminal-progress` | Terminal progress | `true` / `false` |
| `steering-mode` | Steering mode | `one-at-a-time`, `all` |
| `follow-up-mode` | Follow-up mode | `one-at-a-time`, `all` |
| `transport` | Transport | `sse`, `websocket`, `websocket-cached`, `auto` |
| `hide-thinking` | Hide thinking | `true` / `false` |
| `collapse-changelog` | Collapse changelog | `true` / `false` |
| `quiet-startup` | Quiet startup | `true` / `false` |
| `install-telemetry` | Install telemetry | `true` / `false` |
| `double-escape-action` | Double-escape action | `tree`, `fork`, `none` |
| `tree-filter-mode` | Tree filter mode | `default`, `no-tools`, `user-only`, `labeled-only`, `all` |
| `warnings.anthropicExtraUsage` | Anthropic extra usage warning | `true` / `false` (default `true`) |
| `thinking` | Thinking level | `off`, `minimal`, `low`, `medium`, `high`, `xhigh` (default `high`) |
| `theme` | Theme | `dark`, `light` (default `dark`) |

Each item maps 1:1 to a setter on `SettingsManager` via `applySetting` in the
same file. The active provider/model is set per-session through `/model` (format
`provider/model-id`) and `sessions.setModel`, not through this list.

### Pi package filters

`plugins/plugins/src/main/lib/pi-package-settings.ts` models per-package
resource filters. A `PackageSource` is either a `string` (e.g. `"npm:pi-subagents"`)
or an object `{ source, extensions?, skills?, prompts?, themes? }` where each
field is an optional `string[]` of globs. Disabling a package keeps it in the
list but empties all four resource arrays (`createDisabledPackageEntry`); the
previous filters are stashed in a `backups` map and restored on re-enable.
`PI_RESOURCE_TYPES` is `["extensions", "skills", "prompts", "themes"]`.

## Plugin settings

Plugins extend the settings panel by registering a **section** with the
`SettingsRegistryService` (from `@zenbu/settings/services/settings-registry`).
Two shapes are supported:

- **Static items** — `body: { kind: "items", ... }`. The registry renders the
  item models (toggle / select / text / number / button) itself.
- **View-backed section** — `body: { kind: "view", viewType: "<name>" }`. The
  plugin injects a React view (`Service.inject({ name, modulePath, meta: { kind: "view" } })`)
  and the settings panel mounts `<View name="<viewType>" />` when the section is
  selected. This is the escape hatch for dynamic UI (Pi settings uses it).

Canonical example, `pi-settings-section.ts`:

```ts
this.ctx.settingsRegistry.registerSection({
  id: "pi",
  label: "Pi",
  order: 10,
  icon: PI_ICON_SVG,
  body: { kind: "view", viewType: "pi-settings" },
})
```

The `id` is what `/settings sectionId=...` targets; `order` controls placement
in the Plugins tab.
