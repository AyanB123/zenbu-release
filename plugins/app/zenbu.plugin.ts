import { definePlugin } from "@zenbujs/core/config";

/**
 * The host application plugin.
 *
 * Conceptually this *is* the app — services, schema, events,
 * migrations, and the sidebar/tab/etc. icon set all live here.
 * It's still loaded as a regular plugin from the root
 * `zenbu.config.ts`; defining it in its own file (matching the
 * `packages/plan` / `packages/open-files` structure) makes
 * `zen link` write the app's generated types under
 * `packages/app/.zenbu/types/`, which is what
 * `packages/app/tsconfig.json` includes. With the plugin defined
 * inline in the root config, `zen link` only emits types at the
 * repo root, leaving `packages/app/tsconfig.json` unable to
 * resolve `./.zenbu/types/zenbu-register.ts`.
 *
 * Icons below are verbatim copies of lucide v1.16.0 path data
 * (see `node_modules/lucide-react/dist/esm/icons/*.mjs`). Wrapped
 * in the lucide default SVG envelope so they render identically to
 * the lucide-react components used elsewhere in the app.
 */
const SVG_PREFIX =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';
const SVG_SUFFIX = "</svg>";
const lucide = (body: string) => `${SVG_PREFIX}${body}${SVG_SUFFIX}`;

// lucide: message-square
const MESSAGE_SQUARE =
  '<path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"/>';
// lucide: folder
const FOLDER =
  '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>';
// lucide: file
const FILE =
  '<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/>';
// lucide: git-branch
const GIT_BRANCH =
  '<path d="M15 6a9 9 0 0 0-9 9V3"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/>';
// lucide: git-compare
const GIT_COMPARE =
  '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><path d="M11 18H8a2 2 0 0 1-2-2V9"/>';
// lucide: layout-grid
const LAYOUT_GRID =
  '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>';
// lucide: logs
const LOGS =
  '<path d="M3 5h1"/><path d="M3 12h1"/><path d="M3 19h1"/><path d="M8 5h1"/><path d="M8 12h1"/><path d="M8 19h1"/><path d="M13 5h8"/><path d="M13 12h8"/><path d="M13 19h8"/>';
// lucide: terminal
const TERMINAL = '<path d="M12 19h8"/><path d="m4 17 6-6-6-6"/>';
// lucide: git-pull-request
const GIT_PULL_REQUEST =
  '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><line x1="6" x2="6" y1="9" y2="21"/>';
// lucide: list-checks
const LIST_CHECKS =
  '<path d="M13 5h8"/><path d="M13 12h8"/><path d="M13 19h8"/><path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/>';
// lucide: settings
const SETTINGS =
  '<path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/><circle cx="12" cy="12" r="3"/>';

export default definePlugin({
  name: "app",
  services: ["./src/main/services/*.ts"],
  schema: "./src/main/schema/index.ts",
  events: "./src/main/events.ts",
  migrations: "./migrations",
  // Type-only dep so host renderer code (sidebar keyboard nav,
  // worktree-group helpers) can read `root.agentSidebar.*`. zenbu's
  // `dependsOn` is purely a `zen link` directive — it doesn't
  // create a runtime load order, so the agent-sidebar plugin can
  // still declare `dependsOn: app` without a cycle.
  dependsOn: [
    { name: "agentSidebar", from: "../agent-sidebar/zenbu.plugin.ts" },
  ],
  icons: {
    "file-tree": lucide(FOLDER),
    "file-tree-sidebar": lucide(FOLDER),
    file: lucide(FILE),
    "git-tree-sidebar": lucide(GIT_BRANCH),
    "git-diff": lucide(GIT_COMPARE),
    "context-sidebar": lucide(LAYOUT_GRID),
    "pi-event-log": lucide(LOGS),
    terminal: lucide(TERMINAL),
    // The tool-output side view rendered when a user clicks a chat
    // tool-call preview (currently only BashCard). Terminal icon
    // matches the "this is command output" semantics.
    "tool-output": lucide(TERMINAL),
    // The legacy Git view (services/pr.ts) is registered under view
    // type `"git"`. The original `pr` icon name belonged to that
    // view back when it was misnamed; new PR work lives under
    // `"pull-requests"` below.
    git: lucide(GIT_PULL_REQUEST),
    "pull-requests": lucide(GIT_PULL_REQUEST),
    plan: lucide(LIST_CHECKS),
    settings: lucide(SETTINGS),
    // Left-sidebar tab icon for the `agent-sidebar` plugin. lucide
    // message-square — matches the chat-bubble glyph used
    // elsewhere in the app for "a chat".
    agent: lucide(MESSAGE_SQUARE),
  },
});
