# Zenbu Architecture

Read this FIRST. Zenbu's packaging model is unusual and most of what looks like
a "bug" to a newcomer (a dev server running in production, multi-second first
paint, no built bundle) is the intended design. This doc explains why.

The single most important fact: **Zenbu ships as a launcher, not as a built
Electron app.** The installed `.exe` / `.dmg` contains a thin launcher that, on
first run, clones this source mirror, installs it, and serves the renderer from
a Vite dev server -- every boot, for every end user.

## The launcher model

A traditional Electron app builds the renderer (`vite build`), ships the static
`dist/` files inside the installer, and the main process loads them with
`loadFile`. Updates require downloading and replacing the whole installer.

Zenbu inverts this. The package contains only a launcher
(`@zenbujs/core`'s `dist/launcher.mjs`) plus a few config files. The launcher's
job is to materialize the *application itself* on the user's machine:

1. Clone this repo (`zenbu-labs/zenbu-release`, branch `main`) into the user's
   data dir.
2. Run `pnpm install` there. The `pnpm` run applies `patches/@zenbujs__core@*.patch`
   (patched-applied) and pulls Electron in.
3. Start a Vite dev server against the cloned source.
4. Point the Electron main window at the dev server URL via `loadURL`.

The "application" the user runs is therefore this source tree. That is the
trade-off: in exchange for a heavier first run and a per-boot first-paint cost,
Zenbu gets trivial, source-level self-update -- the launcher can refresh the
user's clone and the next boot is the new code, no installer round-trip, no
binary diffing. This is intentional, not a bug.

## What ships in the package

The package is intentionally tiny. Per the electron-builder config and the
launcher contract, the installer contains:

- `dist/launcher.mjs` -- the bootstrap script from `@zenbujs/core` (patched).
- `app-config.json`, `host.json` -- launcher/runtime config.
- `package.json` -- the launcher's own manifest (not the renderer's).
- The Vite/Electron toolchain needed to start the dev server after clone.

It does NOT contain the renderer source, plugin source, `plugins/`, built
`dist/` bundles, or migrations. All of that lives in this mirror and is
fetched at runtime. `zenbu.config.ts`'s `build.include`/`build.ignore` lists
define exactly what the mirror must carry; `build.mirror` pins the
`target` / `branch` the launcher clones.

## First-run flow

On a clean machine the launcher walks a setup gate (see the `setup-gate.mjs`
section of the core patch and `maybeOpenInstallingWindow` in `launcher.mjs`):

1. Show an "installing" splash. (The patch routes this splash through a
   `data:` URL + `loadURL` rather than `loadFile`; this is the ONLY non-dev-server
   URL the launcher loads. The real renderer window never uses `loadFile`.)
2. `git clone` the mirror target into the apps dir. If the entry file
   (`@zenbujs/core`) is missing after clone, the launcher throws:
   `[launcher] expected entry not found ... The cloned source may be missing
   @zenbujs/core in its dependencies.` -- a mirror-contract violation.
3. `pnpm install` in the cloned tree, which applies the `@zenbujs__core` patch.
4. Resolve `zenbu.config.ts`, register the loader, start services, boot Vite.
5. `loadURL(this.ctx.vite.url)` -- the renderer window loads the dev server.

On subsequent boots the clone is already present, so the launcher skips
straight to steps 4-5. Self-update is just "re-clone (or `git pull`) the mirror
and restart"; there is no separate updater binary.

## Boot sequence

The launcher's boot trace (`traces/boot/latest.json`) is the source of truth.
A representative boot on this mirror measures ~21 seconds total
(`totalMs ~= 20958`), broken into phases:

- **pre-eval / prewarm (~0-4s):** Node compile cache, Vite import prewarm
  (`prewarm:vite-import` ~3.3s), Chromium cache repair, `app.whenReady`.
- **config + loader (~4-4.6s):** `loadConfig` resolves `zenbu.config.ts`
  (19 plugins on this tree), then the zenbu loader is registered.
- **services + plugin eval (~4.6-12.3s):** `default-services` (~7.7s). Plugin
  modules are evaluated in parallel (`Promise.all`), completing at
  `plugins-evaluated` (~12.3s). This is where most of the main-process time goes.
- **runtime-when-idle + renderer (~12.3-20.5s):** `runtime-when-idle` (~8.1s)
  starts Vite (`vite:vite-server.listen`, `service:vite` ~1.2s) and opens the
  window. `openWindow:loadURL(main)` is ~6.2s end to end -- that span covers
  the dev server serving the renderer and Chromium's first paint
  (`renderer:prelude-start` ~17.7s, `dom-ready` ~20.5s).

The ~6.2s renderer first-paint cost is INTRINSIC to this architecture. It is
paid on every boot, in the packaged product, not just in dev. There is no
production fast path and no `app.isPackaged` branching anywhere in the boot
path. For a launcher model (clone -> install -> dev server) ~21s total is fast;
the cost is the price of source-level self-update.

## Why the renderer uses a dev server

This is the part that reads as a bug and is not. The trade-off, stated plainly:

- We get: always-fresh source, zero-binary self-update, hot reload in the same
  artifact that ships, no build/bundle step in the release pipeline.
- We pay: a Vite server runs on every install, and the renderer's first paint
  costs ~6s because it is compiled on demand by Vite rather than served from a
  prebuilt static bundle.

If you are tempted to "fix" this by adding `vite build` + `loadFile` for
packaged builds, do NOT do it blindly. That removes the self-update property
that the entire launcher model is built around. Any such change must preserve
the mirror/clone update path or it regresses the core design.

## The mirror contract

For the launcher to work, this repo guarantees a contract to a process that
has no source of its own:

1. **Clean clone works.** The launcher does a plain `git clone` of
   `zenbu-labs/zenbu-release` `main`. Nothing in the boot path may depend on
   files that are gitignored or generated locally (see `.zenbu/`, `dist/`,
   `node_modules/`).
2. **`pnpm install` succeeds and applies patches.** `patches/@zenbujs__core@*.patch`
   and `patches/@zenbujs__hmr@*.patch` must apply cleanly against the versions
   pinned in `package.json` + `pnpm-lock.yaml`.
3. **`zenbu.config.ts` is self-consistent.** `build.mirror.target`/`branch`
   must point back at this repo; `build.include` must list every file the
   boot path imports.
4. **Boot path imports resolve from the mirror alone.** No dev-only symlinks,
   `dev:link` scripts, or local-only deps. (The `trimPackageJson` build plugin
   exists to strip `pnpm.overrides` and dev scripts before mirroring.)

This contract is tracked under **Stage 0 -- Stabilize and Release Mirror**
(Milestone #1). Breaking it (a failed clone, a patch that no longer applies, an
import the mirror doesn't carry) is a release-blocking bug because every
existing user hits it on next boot.

## Implications for contributors

- **Never add `app.isPackaged` assumptions.** There is one code path; it runs
  in dev and in the shipped product. Branching on packaging silently breaks
  the "dev == production" property the launcher relies on.
- **Never assume a built renderer.** The source tree IS the distribution. Do
  not reference `dist/` outputs from main-process code, and do not add a build
  step to the boot path.
- **`loadURL`, not `loadFile`, for the main window.** The only `loadFile`/data-URL
  usage is the first-run splash. The renderer always loads `this.ctx.vite.url`.
- **Tests must pass on a fresh clone.** CI mirrors the launcher's experience:
  clone, install, run. A test that passes only with a warmed local cache is a
  mirror-contract violation waiting to ship.
- **Patching `@zenbujs/core` is normal.** The core patch is part of the
  distribution, not a workaround. Edit it deliberately and keep it in sync with
  the pinned core version.
