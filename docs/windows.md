# Zenbu on Windows

Zenbu is an Electron IDE (`@zenbujs/core` 0.4.4) that originated as a macOS IDE for Pi. **Windows is now the primary development and runtime platform.** This doc covers first-time setup, dev mode, building an installer, and the Windows-specific issues you are likely to hit.

## Prerequisites

- **Windows 10/11 x64** — the build script enforces this (`build-windows.mjs` exits if `process.platform !== "win32"` or `process.arch !== "x64"`).
- **Node.js 22.x** — the Windows toolchain provisioned by `build-windows.mjs` pins `NODE_VERSION = "22.19.0"` (`win-x64`). Use a matching Node on the host for dev.
- **pnpm** — required because `package.json` declares `pnpm.patchedDependencies`. Use the pnpm version recommended for that feature (pnpm 9+).
- **PowerShell** — all Windows launch/debug/perf scripts are `.ps1`. Windows PowerShell 5.1 (built in) is sufficient; PowerShell 7 also works.
- **Git** — `build-windows.mjs` reads the source SHA via `git rev-parse HEAD`; `zenbu.config.ts` clones the source mirror on first run.

## First-time setup

```powershell
git clone git@github.com:zenbu-labs/zenbu-release.git
cd zenbu-release
pnpm install
```

### The `patches/` dependency (important)

`pnpm install` will **fail on a fresh clone unless `patches/` is present.** The root `package.json` declares:

```json
"pnpm": {
  "patchedDependencies": {
    "@zenbujs/hmr@0.0.2": "patches/@zenbujs__hmr@0.0.2.patch",
    "@zenbujs/core@0.4.4": "patches/@zenbujs__core@0.4.4.patch"
  }
}
```

These patches carry critical Windows fixes (loader stats, MessageChannel bridge, Windows file-watcher fixes, lazy component injection, process-exit shutdown flag). They were missing from the mirror historically and were re-committed in `2c93136` (P0-2). Verify after install:

```powershell
pnpm install --offline   # confirms patches resolve without hitting the network
```

Also note `pnpm.onlyBuiltDependencies` allows native builds for `@parcel/watcher`, `electron`, `electron-winstaller`, and `esbuild` — these native modules must compile/download successfully on Windows or dev/build will break.

## Running in dev mode

The dev entrypoint is the only non-PowerShell Windows script:

```json
"dev": "node scripts\\dev.mjs"
```

`scripts/dev.mjs` is a thin shim — it forwards `argv` to the Zenbu CLI binary bundled inside `@zenbujs/core`:

```js
const cliPath = path.resolve("node_modules", "@zenbujs", "core", "dist", "cli", "bin.mjs");
process.argv = [process.argv[0], cliPath, "dev", ...process.argv.slice(2)];
await import(pathToFileURL(cliPath).href);
```

So `pnpm dev` runs `@zenbujs/core`'s `dev` command, which starts Vite + Electron against the working tree.

To launch a built dev Electron directly (foreground window, with a restart loop), use the Windows launcher:

```powershell
pnpm run dev:windows
# Equivalent to:
# powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\launch-windows.ps1 -Restart
```

`launch-windows.ps1` resolves the Electron binary via `require('electron')`, strips conflicting env vars (`ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS`, `ZENBU_AUTO_QUIT_AFTER_IDLE_MS`), sets `ZENBU_DISABLE_DYNOHOT=1` unless `-EnableHmr` is passed, kills any stale `electron.exe` processes bound to this project path (matched via `Win32_Process` command line / `MainWindowTitle -eq "zenbu"`), and starts Electron with `--project=<repo>`. Useful flags: `-Restart` (kill-then-launch), `-ProjectPath <path>`, `-EnableHmr`.

## Building a Windows installer

```powershell
pnpm run build:windows
# node scripts\build-windows.mjs
```

`electron-builder.json` configures the Windows target:

```json
"win":   { "target": ["nsis", "zip"] },
"nsis":  {
  "oneClick": false,
  "perMachine": false,
  "allowToChangeInstallationDirectory": true,
  "createDesktopShortcut": true,
  "createStartMenuShortcut": true,
  "shortcutName": "Zenbu"
}
```

Output goes to `dist/electron/` (`directories.output`), with artifacts named `Zenbu-<version>-x64.exe` / `.zip` (`artifactName`).

`build-windows.mjs` does **not** hand `electron-builder.json` to `electron-builder` verbatim. Its flow:

1. Loads `zenbu.config.ts` via `@zenbujs/core`'s `load-config` helper; requires `build.mirror.target` (the launcher clones this mirror on first run).
2. Creates a temp bundle dir, copies a **patched** `launcher.mjs` from `@zenbujs/core/dist/launcher.mjs` (patches the bundled JS runtime lookup so `node`/`bun` from the staged toolchain hosts `yarn.js`).
3. Provisions a **bundled Windows toolchain** (`provisionWindowsToolchain`) — fetches and SHA-verifies `bun v1.3.12 windows-x64`, Node `22.19.0 win-x64`, and the configured package manager, all from official registries with integrity checks.
4. Stages `installing.html` / `updating.html` / preload / icon if configured.
5. Writes `package.json`, `app-config.json`, `host.json`, and a **merged** `electron-builder.merged.json` (overrides `directories.app` to the bundle dir, sets `files` to `["package.json","app-config.json","host.json","launcher.mjs","!node_modules"]`, forces `npmRebuild: false` and `asar: false`, appends `extraResources` for the toolchain).
6. Invokes `electron-builder --config <merged.json> --win --x64`.

The merged config disables `npmRebuild` and asar because the bundled toolchain ships pre-built native binaries. Don't try to "simplify" by running `electron-builder` directly — you'll lose the toolchain staging.

## Known issues

### `.npmrc script-shell=powershell.exe` (removed)

Earlier revisions shipped a `.npmrc` that forced `script-shell=powershell.exe`. This broke macOS/Linux contributors (P0-3). It was **removed in commit `2c93136`** ("Stage 0: stabilize release mirror + P0 fixes") — there is no `.npmrc` in the tree today. Instead, every npm script that needs PowerShell **invokes it explicitly**, e.g.:

```json
"dev:windows":  "powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\\launch-windows.ps1 -Restart",
"debug:launch": "powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\\launch-debug-windows.ps1 -Restart",
"perf:startup": "powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\\perf\\startup-probe.ps1"
```

This keeps the repo cross-platform: non-Windows contributors can still run `pnpm dev` / `pnpm test` / `pnpm build:source`, and only the `:windows` / `debug:` / `perf:` scripts are Windows-specific. Note the backslash separators (`scripts\\launch-windows.ps1`) — these only resolve correctly on Windows; that's intentional since the targets are `.ps1` files.

### Electron / Chromium cache corruption

If Zenbu fails to boot with `Invalid cache`, white screen, or GPU errors, the disposable Chromium caches under `%APPDATA%\zenbu` are likely corrupt. The repair script removes only the safe-to-delete cache dirs and **preserves Local Storage, IndexedDB, Session Storage, cookies, and the Zenbu DB**:

```powershell
pnpm exec powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\repair-electron-cache.ps1
# Or, if Zenbu is still running:
#   ... repair-electron-cache.ps1 -CloseRunningZenbu
# Custom app-data location:
#   ... repair-electron-cache.ps1 -AppDataPath D:\Elsewhere\zenbu
```

It deletes: `Cache`, `Code Cache`, `DawnGraphiteCache`, `DawnWebGPUCache`, `GPUCache`, `GrShaderCache`, `ShaderCache`. The script refuses to delete any path that resolves outside the Zenbu app-data directory (guard against symlink/junction escapes). The runtime also does a durable (not every-launch) cache repair at startup — see `AGENTS.md` performance notes.

### Path length and separators

- `MAX_PATH` (260 chars) can bite during `pnpm install` of the deep `node_modules` tree, or when the temp bundle dir (`%TEMP%\zenbu-electron-...`) nests under a long repo path. Enable Win10+ long paths (`HKLM\SYSTEM\CurrentControlSet\Control\FileSystem\LongPathsEnabled = 1`) and/or clone to a short root like `C:\dev\zenbu-release`.
- Git will emit LF→CRLF warnings on Windows; these are normal — **do not "fix" them** (per `AGENTS.md`).
- `build-windows.mjs` uses `tar` (bsdtar on Windows 10+) for extraction. If `tar` isn't on `PATH`, both toolchain provisioning and npm-registry cache extraction will fail.

### Process cleanup on restart

`launch-windows.ps1 -Restart` matches stale Electron processes by `Win32_Process.CommandLine` / `ExecutablePath` containing the resolved project path, **and** by `MainWindowTitle -eq "zenbu"`. If you launch multiple Zenbu instances from sibling directories, the title-based match can over-match — pass distinct project paths and don't run `-Restart` while another Zenbu window is active.

## Launch scripts reference

| Script | Purpose |
|---|---|
| `scripts/dev.mjs` | Forwards to `@zenbujs/core` CLI `dev` command (`pnpm dev`). Cross-platform. |
| `scripts/launch-windows.ps1` | Launch dev Electron on Windows. Kills stale project PIDs, sets env, starts foreground window. `-Restart`, `-ProjectPath`, `-EnableHmr`. |
| `scripts/launch-debug-windows.ps1` | Launch with debug harness: CDP on `-CdpPort` (default 9222), logs to `.zenbu/logs/debug/zenbu-debug-<stamp>.{stdout,stderr}.log`, `ZENBU_BOOT_TRACE=1`, optional `-TracePluginImports`, `-AutoQuitAfterIdleMs`, `-NoBootTrace`, `-EnableHmr`. |
| `scripts/repair-electron-cache.ps1` | Clear corrupt Chromium caches under `%APPDATA%\zenbu` while preserving user data. `-CloseRunningZenbu`, `-AppDataPath`, `-WhatIf`. |
| `scripts/perf/startup-probe.ps1` | Boot-trace startup probe; emits `.zenbu/logs/perf/startup-probe-*.log` and `traces/boot/latest.json`. Run via `pnpm run perf:startup`. |
| `scripts/build-windows.mjs` | Produces NSIS installer + zip in `dist/electron/`. Win-x64 only. Stages patched launcher + bundled Node/Bun/PM toolchain, then calls `electron-builder`. |
