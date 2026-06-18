# Zenbu on macOS

Zenbu is an Electron IDE (`@zenbujs/core` 0.4.4) that **originated as a macOS IDE for Pi**. macOS is a supported build and runtime platform alongside Windows. Covers first-time setup, dev mode, and building a `.dmg` on Intel and Apple Silicon. For the detailed Intel-only workaround (Intel host/VM), see [mac-intel-dmg.md](./mac-intel-dmg.md).

## Prerequisites

- **macOS 12+ (Monterey or newer)** -- runs on Intel (`x86_64`) and Apple Silicon (`arm64`).
- **Node.js 22.x** -- match the Node version the Zenbu toolchain stages.
- **pnpm** -- required (`pnpm.patchedDependencies`). Pin via corepack:
  ```sh
  corepack enable
  corepack prepare pnpm@10.13.1 --activate
  ```
- **Xcode Command Line Tools** -- for native module builds (`@parcel/watcher`, `electron`, `esbuild`) and DMG creation:
  ```sh
  xcode-select --install
  ```
- **Git** -- `zenbu.config.ts` clones the source mirror on first run; the build stamps artifacts with `git rev-parse HEAD`.

## First-time setup

```sh
git clone git@github.com:zenbu-labs/zenbu-release.git
cd zenbu-release
pnpm install --frozen-lockfile
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

These patches carry critical fixes (loader stats, MessageChannel bridge, file-watcher fixes, lazy component injection, process-exit shutdown flag). Verify offline:

```sh
pnpm install --offline
```

The build also depends on the source mirror in `zenbu.config.ts` (`mirror: { target: "zenbu-labs/zenbu-release", branch: "main" }`). Before shipping a DMG, ensure the exact source you want the installed app to run is committed on that mirror branch -- the launcher clones it on first run.

## Running in dev mode

Dev mode works the same as on Windows minus the PowerShell launchers. `scripts/dev.mjs` forwards `argv` to the Zenbu CLI binary inside `@zenbujs/core` (`dev` command), starting Vite + Electron against the working tree:

```sh
pnpm dev   # resolves node_modules/@zenbujs/core/dist/cli/bin.mjs dev
```

The `dev:windows`, `debug:launch`, and `perf:startup` scripts are `.ps1` and Windows-only -- on macOS use `pnpm dev` directly.

## Building a .dmg

`electron-builder.json` configures the macOS target:

```json
"mac": {
  "category": "public.app-category.developer-tools",
  "target": ["dmg", "zip"]
}
```

Output goes to `dist/electron/` (`directories.output`), with artifacts named `Zenbu-<version>-<arch>.dmg` / `.zip` (`artifactName`).

There is one shipped build helper, and it is **Intel-only**. `build-mac-intel.mjs` enforces `process.platform === "darwin" && process.arch === "x64"` (exits on Apple Silicon), then runs:

```sh
pnpm run build:mac:intel
# -> zen build:electron -- --mac --x64
```

### Intel vs ARM64 vs universal

The shipped script only covers `--x64`. To target other architectures, call the Zenbu CLI directly:

```sh
# Apple Silicon native
pnpm exec zen build:electron -- --mac --arm64

# Universal binary (largest artifact; runs natively on both)
pnpm exec zen build:electron -- --mac --universal

# Intel (equivalent to build:mac:intel, no host-arch guard)
pnpm exec zen build:electron -- --mac --x64
```

Expected artifacts in `dist/electron/`:

```sh
Zenbu-0.0.5-arm64.dmg    # Apple Silicon
Zenbu-0.0.5-x64.dmg      # Intel
Zenbu-0.0.5.dmg          # universal (no arch suffix)
```

### Verify the artifact

Mount the DMG, install, and check the binary slice:

```sh
hdiutil attach dist/electron/Zenbu-*-x64.dmg     # or -arm64.dmg
cp -R /Volumes/Zenbu/Zenbu.app /Applications/
file /Applications/Zenbu.app/Contents/MacOS/Zenbu
# Intel build -> "x86_64"; Apple Silicon build -> "arm64"
open -a /Applications/Zenbu.app
```

## Apple Silicon notes

On Apple Silicon you have two ways to run Zenbu:

- **Native arm64** -- build with `--arm64` (or `--universal`). Best performance; recommended for M-series Macs.
- **x64 via Rosetta** -- an Intel build (`--x64`) runs under Rosetta 2 transparently. Usable but slower.

### Why the Intel build must be produced on Intel hardware

`zen build:electron` provisions the Zenbu launcher toolchain for the **host CPU**. Electron Builder can emit an `x64` app from Apple Silicon, but Zenbu's launcher toolchain (Bun, Node) would still be staged from the host architecture -- so an Intel DMG cross-built on Apple Silicon bundles an arm64 toolchain inside an x64 app and breaks at runtime. By the same token, `scripts/build-mac-intel.mjs` hard-aborts on anything other than `darwin/x64` (do **not** edit that guard).

For the detailed workaround (running the build on an Intel Mac or Intel macOS VM, SSH/scp flow, verification), see [mac-intel-dmg.md](./mac-intel-dmg.md). It is still required for a genuinely native Intel DMG.

## Known issues

### Signing and notarization

The repo defines the DMG/ZIP target but does **not** ship signing configuration. For local testing, an unsigned DMG opens with macOS security prompts (right-click -> Open, or System Settings -> Privacy & Security -> "Open Anyway"). For distribution, build with Apple Developer ID credentials via Electron Builder environment variables:

```sh
export CSC_LINK=/path/to/developer-id-application.p12
export CSC_KEY_PASSWORD='p12-password'
export APPLE_ID='developer@example.com'
export APPLE_APP_SPECIFIC_PASSWORD='app-specific-password'
export APPLE_TEAM_ID='TEAMID1234'
pnpm run build:mac:intel   # or: pnpm exec zen build:electron -- --mac --arm64
```

Keep those credentials out of the repo.
