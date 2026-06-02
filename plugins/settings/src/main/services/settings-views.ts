import { Service } from "@zenbujs/core/runtime";
import { SettingsRegistryService } from "./settings-registry";

const PANEL_VIEW = "settings";
const RAIL_VIEW = "settings-rail-button";
const UPDATES_VIEW = "settings-updates-panel";
const UPDATES_SECTION_ID = "updates";
const UPDATES_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M16 3h5v5"/></svg>`;

/**
 * Registers the two component views the settings plugin contributes:
 *
 *   - `"settings"` — the main panel. `meta.kind = "view"` so the
 *     host's pane infrastructure can mount it in a tab; the
 *     command palette auto-generates "Open in new tab / split /
 *     replace" rows from the registry entry.
 *
 *   - `"settings-rail-button"` — `meta.kind = "workspace-rail"`,
 *     consumed by the host's `useWorkspaceRailViews` hook and
 *     rendered inside `<WorkspaceRail footer>`.
 *
 * Both views run in the host React tree (no iframe, no Vite, no
 * postMessage bridge) thanks to `rendering: "component"`. Args
 * forwarded by `<View>` arrive as the `args` prop on the
 * component.
 */
export class SettingsViewsService extends Service.create({
  key: "settingsViews",
  deps: {
    settingsRegistry: SettingsRegistryService,
  },
}) {
  evaluate() {
    this.setup("inject-panel-view", () =>
      this.inject({
        name: PANEL_VIEW,
        modulePath: "./src/views/settings-view.tsx",
        meta: { kind: "view", label: "Settings" },
      }),
    );

    this.setup("inject-rail-view", () =>
      this.inject({
        name: RAIL_VIEW,
        modulePath: "./src/views/settings-rail-button.tsx",
        meta: { kind: "workspace-rail", label: "Settings" },
      }),
    );

    this.setup("inject-updates-section", () => {
      const disposeView = this.inject({
        name: UPDATES_VIEW,
        modulePath: "./src/views/panels/updates-panel.tsx",
        meta: { kind: "view", label: "Updates" },
      });
      void this.ctx.settingsRegistry.registerSection({
        id: UPDATES_SECTION_ID,
        label: "Updates",
        order: -10,
        icon: UPDATES_ICON_SVG,
        body: { kind: "view", viewType: UPDATES_VIEW },
      });
      return () => {
        void this.ctx.settingsRegistry.unregisterSection({ id: UPDATES_SECTION_ID });
        disposeView();
      };
    });
  }
}
