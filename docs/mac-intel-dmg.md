# Intel macOS DMG Build

Use this path to build a Zenbu DMG that runs natively on Intel Macs.

## Why this must run on Intel macOS

`zen build:electron` provisions the Zenbu launcher toolchain for the host CPU.
For an Intel-compatible DMG, run the build on an Intel Mac or an Intel macOS VM
so the bundled toolchain and Electron app are both `x64`.

Do not create the Intel DMG from Apple Silicon with cross-build flags. Electron
Builder can emit an `x64` app from Apple Silicon, but Zenbu's launcher toolchain
would still be staged from the host architecture.

## One-time setup on the Intel Mac or VM

```sh
xcode-select --install
corepack enable
corepack prepare pnpm@10.13.1 --activate
pnpm install --frozen-lockfile
```

The build depends on the source mirror in `zenbu.config.ts`:

```ts
mirror: { target: "zenbu-labs/zenbu-release", branch: "main" }
```

Before shipping a DMG, make sure the exact source you want the installed app to
run is committed and available on that mirror branch. The launcher clones that
source on first run.

## Build the Intel DMG

```sh
pnpm run build:mac:intel
```

Expected output directory:

```sh
dist/electron/
```

Expected artifact names include the architecture, for example:

```sh
Zenbu-0.0.5-x64.dmg
Zenbu-0.0.5-x64.zip
```

## Verify the artifact on the Intel Mac

Mount the DMG, copy Zenbu to `/Applications`, then verify the binary slice:

```sh
hdiutil attach dist/electron/Zenbu-*-x64.dmg
cp -R /Volumes/Zenbu/Zenbu.app /Applications/
file /Applications/Zenbu.app/Contents/MacOS/Zenbu
```

The `file` output should report `x86_64`.

Launch from Terminal for first-run diagnostics:

```sh
open -a /Applications/Zenbu.app
```

## Signing and notarization

The repo now defines the DMG/ZIP target, but signing and notarization require
Apple Developer ID credentials on the macOS build machine. For local testing,
an unsigned DMG can be opened with macOS security prompts. For distribution to
other Intel Macs, build on the Intel machine with Developer ID signing and
notarization configured through Electron Builder environment variables.

Common environment inputs are:

```sh
export CSC_LINK=/path/to/developer-id-application.p12
export CSC_KEY_PASSWORD='p12-password'
export APPLE_ID='developer@example.com'
export APPLE_APP_SPECIFIC_PASSWORD='app-specific-password'
export APPLE_TEAM_ID='TEAMID1234'
pnpm run build:mac:intel
```

Keep those credentials out of the repo.

## Remote Intel VM option

If the Intel macOS VM is reachable over SSH, run the same commands there:

```sh
ssh user@intel-mac-vm.local
cd /path/to/zenbu-release
pnpm install --frozen-lockfile
pnpm run build:mac:intel
```

Then copy back the artifact:

```sh
scp user@intel-mac-vm.local:/path/to/zenbu-release/dist/electron/Zenbu-*-x64.dmg .
```
