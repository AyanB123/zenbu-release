import type { Command } from "./types"
import { renderAppsView } from "./views/apps-view"
import { renderCreateZenbuAppView } from "./views/create-zenbu-app-view"
import { renderLaunchDevAppView } from "./views/launch-dev-app-view"

/**
 * In-app command registry. For now this is a plain array — no plugin
 * registry, no dynamic loading. When we generalise the system, each
 * command can come from a service via the kyju view registry pattern;
 * the renderer surface stays identical.
 */
export const COMMANDS: Command[] = [
  {
    id: "apps",
    label: "Apps",
    hint: "Launch a scaffolded zenbu app",
    onSelect: () => ({
      render: renderAppsView,
    }),
  },
  {
    id: "launch-dev-app",
    label: "Launch dev app",
    hint: "Run a registered app in dev mode",
    onSelect: () => ({
      title: "Launch dev app",
      render: renderLaunchDevAppView,
    }),
  },
  {
    id: "create-zenbu-app",
    label: "Create Zenbu app",
    hint: "Scaffold a new desktop app",
    onSelect: () => ({
      render: renderCreateZenbuAppView,
    }),
  },
]
