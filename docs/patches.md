# Patching @zenbujs/core and @zenbujs/hmr

Zenbu depends on `@zenbujs/core` and `@zenbujs/hmr` as published npm packages,
but the shipped builds need fixes that are not yet upstream. Rather than fork the
packages, we ship [pnpm `patchedDependencies`](https://pnpm.io/cli/patch) that
rewrite files inside `node_modules` at install time. The patch files live in
`patches/` and are committed to this repo.

## Why patches exist

The framework packages are consumed as black-box `dist/` bundles, but Zenbu the
app needs behavior the upstream releases don't provide yet:

- **Windows support** -- upstream paths/bin lookups assume macOS (`Electron.app`,
 `bun`, `pnpm`, `git` with no `.exe`). The patches add `process.platform ===
 "win32"` branches throughout.
- **Bundled-tool selection** -- the installer host runtime is hardcoded to `bun`;
 the patches let it fall back to bundled `node`.
- **Loader correctness** -- the TypeScript loader in `dist/loaders/zenbu.mjs` is
 substantially rewritten for plugin resolution, service auto-registration, and
 glob handling.
- **Vite/React injection robustness** -- lazy-component injection, advice-transform
 scoping, `Suspense` wrapping for `<View>`, and a clean Vite teardown on exit.

Because these are applied via `pnpm patchedDependencies`, every `pnpm install`
re-applies them automatically -- no manual step is needed after checkout.

## Current patches

| Package | Version | Patch file | What it changes |
| ---------------------- | ------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@zenbujs/core` | 0.4.4 | `patches/@zenbujs__core@0.4.4.patch` | Touches **10** files under `dist/`. (1) `loaders/zenbu.mjs` -- near-complete rewrite of the TS loader: adds `buildPluginsRoot`, `buildRegistryModule`, `buildPluginBarrel`, `resolveCoreSubpath`, `getCoreExports`, `loadNativeStrippedTs`, `stripTypeScriptTypesQuietly`, `resolveConfigViaSubprocess`, plus `ZENBU_TRACE_PLUGIN_IMPORTS` / `ZENBU_SERIAL_PLUGIN_IMPORTS` debug knobs. (2) `launcher.mjs` & `updater-5PTpBkRg.mjs` -- `bundledToolPath` now tries `name.exe` on Windows; `runInstall` uses `node ?? bun` as the JS runtime for pnpm/npm/yarn; `buildInstallEnv` injects an isolated `.npmrc` userconfig on Windows. (3) `env-bootstrap.mjs` -- adds `toolName()` so `bunPath`/`pnpmPath`/`gitPath` get `.exe` suffixes on Windows. (4) `dev-BsGaKfbp.mjs` -- `resolveLocalElectron` prefers `electron.exe` / `electron.cmd`; `runDev` strips `ELECTRON_RUN_AS_NODE` from the child env; watcher subscription gets a `windows` backend. (5) `db-CQTfJMLv.mjs` -- same `windows` watcher backend. (6) `react.mjs` -- imports `Suspense` and wraps `<View>` children in `<Suspense fallback>`. (7) `vite-BYLT44ru.mjs` -- Vite cleanup is skipped when `globalThis.__zenbu_exiting_process__`. (8) `vite-plugins-C4F04RwC.mjs` -- lazy-component injection (`lazy` kinds wrapped in `React.lazy`), `shouldRunAdviceTransform` scopes the babel advice transform to only wrapped modules, and plugin-sources CSS scans multiple renderer source dirs. (9) `setup-gate.mjs` -- Windows-aware Electron app loading and config-phase resolution. |
| `@zenbujs/hmr` | 0.0.2 | `patches/@zenbujs__hmr@0.0.2.patch` | One file: `dist/runtime/safe-subscribe.js`. Passes `{ backend: "windows" }` to `@parcel/watcher`'s `subscribe()` on Windows so file-watching works outside the default backend. (Also normalizes a missing trailing newline.) |

## How pnpm applies them

The patches are declared in `package.json` under `pnpm.patchedDependencies`:

```json
"pnpm": {
 "patchedDependencies": {
 "@zenbujs/hmr@0.0.2": "patches/@zenbujs__hmr@0.0.2.patch",
 "@zenbujs/core@0.4.4": "patches/@zenbujs__core@0.4.4.patch"
 }
}
```

The key format is `<package>@<exact-version>`, and the value is the patch path
relative to the repo root. The `@` in the package name is rendered as `__` in the
filename (pnpm convention).

On `pnpm install`, pnpm:

1. Resolves and downloads the named version of each package into the store.
2. Before linking it into `node_modules`, applies the referenced `.patch` file.
3. Verifies the patched package's hash matches the lockfile -- if the upstream
 tarball changes, the patch fails to apply and install aborts (this is the
 version-drift guardrail).

No `postinstall` script is involved; the mechanism is built into pnpm itself.

## Regenerating a patch

Patches are built with pnpm's built-in `patch` / `patch-commit` workflow. There
is a gitignored `.patch-work/` directory at the repo root (see `.gitignore`)
used as a scratch area for in-progress patch edits -- it is **not** committed.

To regenerate or modify the `@zenbujs/core` patch:

```bash
# 1. Have pnpm check out an editable copy of the exact pinned version.
pnpm patch @zenbujs/core@0.4.4
# -> prints a temp dir, e.g. /tmp/.../pnpm-XXXX/@zenbujs/core

# 2. Edit files in that directory. (You can mirror intermediate work into
# .patch-work/ for repeated iterations.) Make your changes to the dist/
# files -- e.g. dist/loaders/zenbu.mjs, dist/launcher.mjs, etc.

# 3. Finalize: generate the .patch and write it into patches/.
pnpm patch-commit <the-temp-dir-from-step-1>
# -> updates patches/@zenbujs__core@0.4.4.patch and the patchedDependencies
# entry automatically.
```

For `@zenbujs/hmr`:

```bash
pnpm patch @zenbujs/hmr@0.0.2
# edit dist/runtime/safe-subscribe.js
pnpm patch-commit <temp-dir>
```

Then commit the updated `patches/*.patch` file and `package.json`/lockfile
together.

Tips:

- `pnpm patch` checks out the **currently installed** version, so make sure
 `pnpm install` is clean and the version in `package.json` matches the one in
 the `patchedDependencies` key before you start.
- `patch-commit` is what produces the unified diff; do not hand-edit the
 `.patch` file unless you're comfortable with the format.
- Because the patches modify committed `dist/` bundles, prefer minimal,
 well-scoped edits -- large rewrites (like the `loaders/zenbu.mjs` one) make
 future rebases harder.

## Version drift risk

The `patchedDependencies` keys pin an **exact** version (`@zenbujs/core@0.4.4`).
If the version in `dependencies` bumps past `0.4.4`:

- pnpm will refuse to apply the patch (version mismatch in the key), or
- if the key is updated to the new version without regenerating the patch, the
 hunks will likely fail to apply because the upstream `dist/` line numbers and
 surrounding context have shifted.

Either way, **bumping `@zenbujs/core` requires regenerating the patch.** The
safe procedure is: bump the version in `package.json`, drop the old
`patchedDependencies` entry, `pnpm install`, re-apply your edits via
`pnpm patch @zenbujs/core@<new-ver>` / `pnpm patch-commit`, and verify the app
still boots on both macOS and Windows.

This is tracked as **issue #6** -- a CI guard is planned to detect drift
(`dependencies` version vs. the version named in `patchedDependencies`) and
fail the build before a broken `pnpm install` can land. Until that lands,
reviewers should manually confirm the two versions stay in sync on any PR that
touches `@zenbujs/core` or `@zenbujs/hmr`.
