import {
  defineConfig,
  definePlugin,
  defineBuildConfig,
  type BuildPlugin,
} from "@zenbujs/core/config";

/**
 * Strips dev-only **scripts** from the staged `package.json`. The heavy
 * lifting (removing `pnpm.overrides` + `@zenbu/act`) happens earlier in
 * `scripts/release.sh`, *before* `pnpm install`, so the regenerated
 * lockfile stays consistent with what we ship.
 *
 * This plugin only handles cosmetic cleanup: dropping scripts that
 * reference files we don't ship (`scripts/release.sh`, `scripts/sync.sh`,
 * `scripts/dev-link.mjs`). It also acts as a belt-and-suspenders for
 * `pnpm.overrides` in case `build:source` is run directly without going
 * through `release.sh`.
 */
const trimPackageJson: BuildPlugin = {
  name: "trim-package-json",
  transform(file) {
    if (file.path !== "package.json") return;
    const pkg = JSON.parse(file.contents);

    if (pkg.pnpm?.overrides) {
      delete pkg.pnpm.overrides;
      if (Object.keys(pkg.pnpm).length === 0) delete pkg.pnpm;
    }

    if (pkg.scripts) {
      delete pkg.scripts["dev:link"];
      delete pkg.scripts["dev:unlink"];
      delete pkg.scripts.sync;
      delete pkg.scripts.release;
      delete pkg.scripts["release:source"];
      delete pkg.scripts["release:electron"];
    }

    return JSON.stringify(pkg, null, 2) + "\n";
  },
};

export default defineConfig({
  // Boot-window HTML. The single ui entrypoint for the whole app.
  uiEntrypoint: "./packages/app/src/renderer",

  // Plugins are pure main-process: services + optional schema/preload/events.
  // The "host plugin" is just the first entry by convention.
  plugins: [
    definePlugin({
      name: "app",
      services: ["./packages/app/src/main/services/*.ts"],
      schema: "./packages/app/src/main/schema.ts",
      events: "./packages/app/src/main/events.ts",
      migrations: "./packages/app/migrations",
      icons: {
        "file-tree":
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
        "file-tree-sidebar":
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
        file: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/></svg>',
        "git-tree-sidebar":
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="2.25"/><circle cx="6" cy="18" r="2.25"/><circle cx="18" cy="12" r="2.25"/><path d="M6 8.25v7.5"/><path d="M6 12h7a3 3 0 0 0 3-3v-.75"/></svg>',
        "git-diff":
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18"/><path d="M5 7h4"/><path d="M5 11h4"/><path d="M5 15h4"/><path d="M15 7h4"/><path d="M15 11h4"/><path d="M15 15h4"/></svg>',
        "context-sidebar":
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="5" height="5" rx="1"/><rect x="10.5" y="3.5" width="5" height="5" rx="1" fill="currentColor"/><rect x="17.5" y="3.5" width="3" height="5" rx="1"/><rect x="3.5" y="10.5" width="5" height="5" rx="1" fill="currentColor"/><rect x="10.5" y="10.5" width="5" height="5" rx="1"/><rect x="17.5" y="10.5" width="3" height="5" rx="1"/><rect x="3.5" y="17.5" width="5" height="3" rx="1"/><rect x="10.5" y="17.5" width="5" height="3" rx="1"/><rect x="17.5" y="17.5" width="3" height="3" rx="1"/></svg>',
        "pi-event-log":
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16"/><path d="M4 12h10"/><path d="M4 18h13"/><circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="20" cy="18" r="1.5" fill="currentColor" stroke="none"/></svg>',
        terminal:
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>',
        pr: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="2.25"/><circle cx="6" cy="18" r="2.25"/><circle cx="18" cy="18" r="2.25"/><path d="M6 8.25v7.5"/><path d="M11 6h4a3 3 0 0 1 3 3v6.75"/><path d="M14 9l-3-3 3-3"/></svg>',
        plan: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 9h8"/><path d="M8 13h8"/><path d="M8 17h5"/></svg>',
      },
    }),
    "./packages/plan/zenbu.plugin.ts",
    "./packages/open-files/zenbu.plugin.ts",
  ],

  // Build pipeline for `zen build:source` (mirror staging) and
  // `zen build:electron` (signed .app via electron-builder).
  build: defineBuildConfig({
    packageManager: { type: "pnpm", version: "10.13.1" },
    // The .app's "host version" comes from `package.json#version` —
    // read at build time and baked into <bundle>/host.json. Bump
    // `package.json#version` every time you ship a new .app build.
    out: ".zenbu/build/source",
    include: [
      "packages/app/src/**",
      "packages/app/migrations/**",
      "packages/app/package.json",
      "packages/app/tsconfig.json",
      "packages/app/vite.config.ts",
      "packages/plan/src/**",
      "packages/plan/zenbu.plugin.ts",
      "packages/plan/package.json",
      "packages/plan/tsconfig.json",
      "packages/open-files/src/**",
      "packages/open-files/zenbu.plugin.ts",
      "packages/open-files/package.json",
      "packages/open-files/tsconfig.json",
      "packages/view-theme/**",
      ".gitignore",
      "package.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      "tsconfig.json",
      "zenbu.config.ts",
    ],
    ignore: [
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/*.spec.ts",
      "**/*.spec.tsx",
      "**/dev-only/**",
      "**/.zenbu/**",
      "**/node_modules/**",
      "**/.env",
      "**/.env.*",
      "**/dist/**",
      "**/traces/**",
      "**/.DS_Store",
    ],
    plugins: [trimPackageJson],
    mirror: { target: "zenbu-labs/zenbu-release", branch: "main" },
  }),
});
