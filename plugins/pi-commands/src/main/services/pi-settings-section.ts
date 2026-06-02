import { Service } from "@zenbujs/core/runtime";
import { SettingsRegistryService } from "@zenbu/settings/services/settings-registry";

const SECTION_ID = "pi";
const VIEW_NAME = "pi-settings";

/**
 * Contributes a "Pi" section to the settings panel's Plugins tab.
 *
 * Pi settings come from the underlying `pi` binary and are
 * dynamic-per-cwd, so the static `settingsRegistry` item model
 * (toggle / select / text / number / button) can't capture them
 * directly. Instead we use the registry's `body: { kind: "view" }`
 * escape hatch: the section's body is mounted as a
 * `<View name="pi-settings" />` and the view owns its own UI.
 *
 * Two registrations land in this service:
 *
 *  1. A `rendering: "component"` view, `"pi-settings"`, pointing at
 *     the panel React component shipped in this plugin. Component
 *     views run in the host React tree so the panel can `useDb` /
 *     `useRpc` directly.
 *
 *  2. A `view`-mode settings section linking the two together. The
 *     settings panel reads `root.settings.registry.sections` and
 *     mounts the right view when the user selects this section.
 *
 * This is the canonical pattern for plugins with bespoke settings
 * UI \u2014 see also the doc comment on
 * `SettingsRegistryService.registerSection`.
 */
export class PiSettingsSectionService extends Service.create({
  key: "piSettingsSection",
  deps: {
    settingsRegistry: SettingsRegistryService,
  },
}) {
  evaluate() {
    this.setup("inject-view", () =>
      this.inject({
        name: VIEW_NAME,
        modulePath: "./src/views/pi-settings-section-view.tsx",
        meta: { kind: "view", label: "Pi settings" },
      }),
    );

    this.setup("register-section", () => {
      void this.ctx.settingsRegistry.registerSection({
        id: SECTION_ID,
        label: "Pi",
        order: 10,
        icon: PI_ICON_SVG,
        body: { kind: "view", viewType: VIEW_NAME },
      });
      return () => {
        void this.ctx.settingsRegistry.unregisterSection({
          id: SECTION_ID,
        });
      };
    });
  }
}

// Small terminal-prompt glyph for the sidebar tile.
const PI_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>`;
