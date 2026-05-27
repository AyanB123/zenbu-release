# Pi extensions

App-owned Pi extensions live here and are loaded in memory through the Pi SDK:

- Export a `createXExtension(cwd: string): ExtensionFactory` helper from a focused module, e.g. `my-extension.ts`.
- Add it to `createAppPiExtensionFactories(cwd)` in `index.ts`.
- Do not add app-owned extensions to `.pi/extensions/`; that only affects CLI sessions whose cwd is this repo.
- Use `PiExtensionRegistryService` path registration for external Zenbu plugins whose extension source lives in the plugin package.

This keeps extensions type-checked with the app and guarantees embedded sessions load them regardless of the user's active project directory.
