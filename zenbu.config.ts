import {
	defineConfig,
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
	// Each plugin owns its own folder under `packages/`. Defining the host
	// plugin in its own file (rather than inline here) is what lets
	// `zen link` write the host's generated types under
	// `packages/app/.zenbu/types/`, where `packages/app/tsconfig.json`
	// expects to find them.
	plugins: [
		"./packages/app/zenbu.plugin.ts",
		"./packages/plan/zenbu.plugin.ts",
		"./packages/react-doctor/zenbu.plugin.ts",
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
			"packages/react-doctor/src/**",
			"packages/react-doctor/migrations/**",
			"packages/react-doctor/zenbu.plugin.ts",
			"packages/react-doctor/package.json",
			"packages/react-doctor/tsconfig.json",
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
