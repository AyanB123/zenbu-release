import path from "node:path";
import { fileURLToPath } from "node:url";
import { Service } from "@zenbujs/core/runtime";
import { ViewRegistryService } from "@zenbujs/core/services";
import { SettingsRegistryService } from "./settings-registry";

const here = path.dirname(fileURLToPath(import.meta.url));
const PANEL_VIEW_SOURCE = path.resolve(
  here,
  "../../views/settings-view.tsx",
);
const RAIL_VIEW_SOURCE = path.resolve(
  here,
  "../../views/settings-rail-button.tsx",
);
const UPDATES_VIEW_SOURCE = path.resolve(
  here,
  "../../views/panels/updates-panel.tsx",
);

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
    viewRegistry: ViewRegistryService,
    settingsRegistry: SettingsRegistryService,
  },
}) {
  evaluate() {
    this.setup("register-panel-view", () => {
      void this.ctx.viewRegistry.registerView({
        type: PANEL_VIEW,
        rendering: "component",
        source: { modulePath: PANEL_VIEW_SOURCE },
        meta: { kind: "view", label: "Settings" },
      });
      return () => {
        void this.ctx.viewRegistry.unregisterView(PANEL_VIEW);
      };
    });

    this.setup("register-rail-view", () => {
      void this.ctx.viewRegistry.registerView({
        type: RAIL_VIEW,
        rendering: "component",
        source: { modulePath: RAIL_VIEW_SOURCE },
        meta: { kind: "workspace-rail", label: "Settings" },
      });
      return () => {
        void this.ctx.viewRegistry.unregisterView(RAIL_VIEW);
      };
    });

    this.setup("register-updates-section", () => {
      void this.ctx.viewRegistry.registerView({
        type: UPDATES_VIEW,
        rendering: "component",
        source: { modulePath: UPDATES_VIEW_SOURCE },
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
        void this.ctx.viewRegistry.unregisterView(UPDATES_VIEW);
      };
    });
  }
}
