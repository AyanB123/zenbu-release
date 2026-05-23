import { collection, createSchema, z } from "@zenbujs/core/db";
import type { InferSchemaRoot } from "@zenbujs/core/db";

const providerModel = z.object({
  provider: z.string(),
  id: z.string(),
});

const thinkingLevel = z.enum([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
]);

const worktree = z.object({
  path: z.string(),
  branch: z.string().nullable(),
  headSha: z.string(),
  isPrimary: z.boolean(),
  locked: z.boolean(),
  prunable: z.boolean(),
});

const branch = z.object({
  name: z.string(),
  upstream: z.string().nullable(),
  headSha: z.string(),
  lastCommitAt: z.number(),
});

const repo = z.object({
  id: z.string(),
  commonDir: z.string(),
  mainWorktreePath: z.string(),
  worktrees: z.array(worktree),
  branches: z.array(branch),
  syncedAt: z.number(),
});

const workspaceIcon = z.object({
  blobId: z.string(),
  mimeType: z.string(),
});

const workspace = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.number(),
  icon: workspaceIcon.nullable().default(null),
  archived: z.boolean().default(false),
  /** Built-in "self-edit" workspace pinned at the bottom of the
   * workspace rail. Pointed at the app's own source tree so users
   * can hack on the IDE from inside the IDE. Created once by
   * `SentinelWorkspaceService` on first boot and never deleted /
   * archived through the normal UI paths. */
  sentinel: z.boolean().default(false),
});

const scope = z.object({
  id: z.string(),
  workspaceId: z.string(),
  directory: z.string(),
  repoId: z.string().nullable(),
  extraDirectories: z.array(z.string()),
  createdAt: z.number(),
  /** Soft-delete flag, same semantics as `session.archived`:
   * archived scopes are hidden from the worktree-group sidebar
   * but their data (chats, sessions, tabs) is left intact. The
   * "Import Worktrees" action un-archives matching scopes so
   * the user can bring a hidden worktree back without manual
   * cleanup. */
  archived: z.boolean().default(false),
  /** "Completed" flag. Mirrors `archived` semantically (hides the
   * worktree from the sidebar without destroying any data) but
   * carries a different intent: archive = "shelve, I'm done with
   * this for now", completed = "this work is finished, ship it".
   * A scope can be archived OR completed; the sidebar's
   * archive-or-completed footer menu treats them as two parallel
   * buckets and lets the user toggle either flag back to false to
   * bring the worktree back. */
  completed: z.boolean().default(false),
  /** Wall-clock time (unix ms) the user most recently archived
   * this scope, or `null` if it isn't archived. Cleared back to
   * null when the scope is un-archived. Kept alongside the boolean
   * flag so the footer popover can sort archived worktrees by
   * most-recently-archived without paying a full session/chat
   * lookup, and so future UI can group them by day/week. */
  archivedAt: z.number().nullable().default(null),
  /** Wall-clock time (unix ms) the user most recently marked this
   * scope as completed, or `null` if it isn't completed. Same
   * lifetime rules as `archivedAt`. */
  completedAt: z.number().nullable().default(null),
  /** Wall-clock time (unix ms) the scope was most recently pinned
   * to the top of the worktree-group sidebar, or `null` if it
   * isn't pinned. Multiple scopes can be pinned simultaneously;
   * the sidebar sorts them by `pinnedAt` descending (most
   * recently pinned first). The "main" worktree (the one whose
   * directory matches its repo's `mainWorktreePath`) is pinned
   * automatically the first time it materializes, so users see a
   * stable anchor row at the top of the list. Cleared back to
   * `null` when the user unpins. */
  pinnedAt: z.number().nullable().default(null),
  /** Wall-clock time (unix ms) the scope was most recently
   * unpinned, or `null` if it has never been unpinned. Used as
   * the priority sort key for the *unpinned* section of the
   * sidebar: `priority = max(unpinnedAt ?? 0, createdAt)` so a
   * freshly-unpinned scope bubbles to the top of the unpinned
   * group instead of dropping to the bottom (which would feel
   * like "I just lost it"). Survives a re-pin so the priority
   * isn't reset on every toggle. */
  unpinnedAt: z.number().nullable().default(null),
  /** When set, this scope was materialized by the "Create Plugin"
   * action: its directory is a git worktree of the sentinel
   * (self-edit) repo at `~/.zenbu/plugin-worktrees/<pluginName>`,
   * and the scope's `extraDirectories` includes the standalone
   * plugin source at `~/.zenbu/plugins/<pluginName>`. Acts as a
   * generic "this worktree has a purpose tag" discriminator so
   * the sidebar can paint a puzzle icon next to the group
   * without having to introspect the filesystem. Null for
   * regular worktrees. */
  pluginName: z.string().nullable().default(null),
});

const chatSessionRef = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("pending") }),
  z.object({ kind: z.literal("ready"), sessionId: z.string() }),
]);

const chat = z.object({
  id: z.string(),
  scopeId: z.string(),
  session: chatSessionRef,
  createdAt: z.number(),
});

const queueState = z.object({
  steering: z.array(z.string()),
  followUp: z.array(z.string()),
})

/**
 * Queue shadow: pi only stores `string[]` for its steering/followUp
 * queues, so anything richer (ids, image refs, lexical-ish editor state,
 * createdAt, edit-by-id) lives here and is reconciled into pi via
 * `clearQueue() + replay` on edits. Items are always live (mirrored
 * in pi's queue, awaiting delivery) — there's no held/paused state.
 */
const queuedMessage = z.object({
  id: z.string(),
  text: z.string(),
  images: z
    .array(z.object({ blobId: z.string(), mimeType: z.string() }))
    .default([]),
  editorState: z.unknown().nullable().default(null),
  createdAt: z.number(),
  kind: z.enum(["steer", "followUp"]),
});

const eventItem = z.object({
  seq: z.number(),
  kind: z.string(),
  payload: z.unknown(),
  timestamp: z.number(),
});

const sessionStats = z.object({
  tokens: z.object({
    input: z.number(),
    output: z.number(),
    cacheRead: z.number(),
    cacheWrite: z.number(),
  }),
  cost: z.number(),
  contextUsage: z
    .object({
      tokens: z.number().nullable(),
      contextWindow: z.number(),
      percent: z.number().nullable(),
    })
    .nullable(),
  autoCompactionEnabled: z.boolean(),
});

const session = z.object({
  id: z.string(),
  scopeId: z.string(),

  parentSessionId: z.string().nullable(),
  parentEntryId: z.string().nullable(),

  title: z.string(),
  sessionFile: z.string(),
  piSessionId: z.string(),
  createdAt: z.number(),
  lastActivityAt: z.number(),

  model: providerModel.nullable(),
  thinkingLevel: thinkingLevel,
  isStreaming: z.boolean(),
  currentLeafEntryId: z.string().nullable(),
  queue: queueState,
  /** Snapshot of `stats.contextUsage.tokens` taken on `agent_start`,
   * cleared on `agent_end`. Subtracting from the live
   * `stats.contextUsage.tokens` yields the tokens added to the
   * conversation by the *current* agent run, which is what the chat
   * surface displays in its streaming "Xs, N tokens" indicator.
   * Uses pi's context-window measurement (not the billing rollup
   * `stats.tokens.input/output/...`), because that rollup sums
   * every LLM call's `usage.input` and double-counts the growing
   * context across multi-turn (tool-call) runs. Null when no run
   * is in flight. */
  runStartContextTokens: z.number().nullable().default(null),
  /** Wall-clock time the user most recently "opened" this session in
   * any window (i.e. it became the active tab of some pane, or fired
   * `agent_end` while the user was already viewing it). Stamped by
   * `SessionActivityService`, which subscribes to `windowStates` and
   * watches the active session per pane. Compared against
   * `lastCompletedAt` to drive the unread-dot in the sidebar / pane
   * tabstrip: `dot = lastCompletedAt > (lastOpenedAt ?? 0)`. Null
   * until the session has been opened at least once. */
  lastOpenedAt: z.number().nullable().default(null),
  /** Wall-clock time the agent last finished a turn for this session
   * (`agent_end` from pi). Stamped by `SessionsService`. Drives the
   * unread-dot in the sidebar / pane tabstrip; cleared/overtaken by
   * `lastOpenedAt` as soon as the user looks at the session again.
   * Null when the session has never completed a turn. */
  lastCompletedAt: z.number().nullable().default(null),
  /** Rich shadow of pi's queue. Authoritative for payload; pi is
   * authoritative for delivery ordering within each kind. */
  queueDraft: z.array(queuedMessage).default([]),
  subscriberCount: z.number(),
  leafCount: z.number(),
  branchSummary: z.string().nullable(),
  stats: sessionStats,
  /** Soft-delete flag: archived sessions are hidden from list UIs
   * (sidebar, palette) but their data is left intact. */
  archived: z.boolean().default(false),

  eventLog: collection(eventItem, { debugName: "events" }),
});

const chatState = z.object({
  chatId: z.string(),
  locked: z.boolean(),
  /** Persisted composer input for this chat. Plain doc text — file
   * pills (`@<path>`) re-decorate from the scanner on restore, and
   * image pills (`@blob:<id>`) re-hydrate from the zenbu blob store
   * via `hydrateImage`. Treat this as the clipboard-equivalent of
   * the editor: copy the string, paste elsewhere, paste back — same
   * thing. Empty string means no draft. */
  draft: z.string().default(""),
});

const leftSidebarTab = z.enum(["agent", "pi-sessions", "extra-dirs"]);

/**
 * What the window's center pane currently shows, and the data the
 * non-onboarding cases need. Modeled as a discriminated union so
 * the workspace id only exists when there's actually a workspace
 * open — no "last workspace" leaking into views that should be
 * showing onboarding.
 *
 * Today there are two kinds:
 *   - `workspace`: a real workspace is open. `workspaceId` keys
 *     into `root.app.workspaces` and into the window's
 *     `workspacePanes` map.
 *   - `onboarding`: render the onboarding screen (used when the
 *     user clicks the "+" in the workspace rail, and as the
 *     initial state on a fresh install before any workspace has
 *     been created).
 *
 * Future non-workspace center views (settings page, marketplace,
 * etc.) extend this union by adding new cases.
 *
 * TODO(zenbu.js): formalize this as a proper server-side derived
 * router primitive in core rather than a hand-rolled field.
 */
const activeView = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("workspace"),
    workspaceId: z.string(),
  }),
  z.object({ kind: z.literal("onboarding") }),
]);

/**
 * Obsidian-style pane state for the chat working area. Each scope has
 * its own list of panes; each pane has its own list of tabs that point
 * at chats. A tab's `chatId` may be `null` — that's the "empty tab"
 * state where the UI offers actions like "create a new chat".
 *
 * Invariants the UI relies on (and helpers enforce):
 *  - `panes` is non-empty.
 *  - `activePaneId` always names a pane in `panes`.
 *  - every pane's `tabs` is non-empty and `activeTabId` names a tab.
 */
/**
 * A pane tab can host one of several content kinds. `chat` keeps the
 * old behaviour (chatId may be null for an unfilled tab). `view`
 * embeds an arbitrary registered view (file-tree, pi-event-log, pr,
 * or any future plugin view) and carries an optional `args` payload
 * forwarded to the iframe via `?args=` so the view can read it with
 * `useViewArgs()`.
 */
const paneTabContent = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("chat"),
    chatId: z.string().nullable(),
  }),
  z.object({
    kind: z.literal("view"),
    viewType: z.string(),
    args: z.record(z.string(), z.unknown()).default({}),
  }),
]);

/**
 * Per-tab navigation history. Mirrors the browser model: an ordered
 * list of past views with a cursor (`index`) pointing at the currently
 * visible one. `entries[index]` is always equal to the tab's `content`
 * — we keep `content` denormalized so callers that just want to
 * render the active view don't have to walk the stack.
 *
 * Pushing a new view (any "navigate" / "replace tab content"
 * operation) truncates the future (`entries[index+1..]`) and appends
 * the new view, matching how a browser drops forward history when
 * you navigate after going back. Going back/forward only moves the
 * cursor; it never edits the entries list.
 */
const paneTabHistory = z.object({
  entries: z.array(paneTabContent),
  index: z.number(),
});

const paneTab = z.object({
  id: z.string(),
  content: paneTabContent,
  history: paneTabHistory.default({ entries: [], index: -1 }),
});

const chatPane = z.object({
  id: z.string(),
  tabs: z.array(paneTab),
  activeTabId: z.string(),
});

const workspacePaneState = z.object({
  panes: z.array(chatPane),
  activePaneId: z.string(),
});

/**
 * Per-workspace shell UI state. Holds the things that are truly
 * workspace-wide (i.e. don't change as the active worktree
 * changes inside the workspace): the left sidebar's width,
 * whether it's open, and which tab inside it is selected.
 *
 * Everything that follows the active worktree/scope (right
 * sidebar, bottom panel — their content is parameterized by
 * scopeId/directory) lives on `scopeUiState` instead.
 *
 * Sizes use absolute pixels; `null` means "never saved, fall
 * back to the shell's default". Writes flow through Allotment's
 * `onDragEnd` so our own imperative `resize(...)` calls during
 * workspace/scope switch don't re-enter the persistence path.
 */
const workspaceUiState = z.object({
  sidebarWidth: z.number().nullable().default(null),
  leftSidebarOpen: z.boolean().default(true),
  leftSidebarTab: leftSidebarTab.default("agent"),
});

/**
 * Per-scope shell UI state. The right sidebar and bottom panel
 * already render scope-parameterized content (their views are
 * passed `scopeId` / `directory` as args), so it would be
 * disorienting for the layout state — which view is open, how
 * wide / tall it is, whether the panel is expanded at all — to
 * stay constant while the content underneath swaps out. We keep
 * those bits keyed by scopeId here.
 *
 * Scope state lives on `windowState` (and not on the scope
 * record itself) because the same scope can be open in multiple
 * windows, each with its own panel layout.
 *
 * `null` size = "never saved, fall back to shell default".
 * `null` view selector = "use the first registered view" /
 * "panel is collapsed". Open flags default to closed because a
 * freshly visited scope shouldn't pop open panels the user
 * hasn't asked for yet.
 */
const scopeUiState = z.object({
  rightSidebarWidth: z.number().nullable().default(null),
  terminalHeight: z.number().nullable().default(null),
  bottomPanelOpen: z.boolean().default(false),
  bottomPanelView: z.string().nullable().default(null),
  rightSidebarOpenType: z.string().nullable().default(null),
  rightSidebarLastType: z.string().nullable().default(null),
});

const windowState = z.object({
  /** Denormalized cache of `chats[activeChatId]?.scopeId`. Kept in
   * sync by every pane/tab mutation helper so iframe views that
   * walk window-state directly (file-tree, git-tree, pi-event-log,
   * pr, context-sidebar) keep working without having to traverse
   * the workspace pane tree themselves. Always equal to the
   * scopeId of the active tab's chat in the active workspace. */
  selectedScopeId: z.string().nullable(),
  scopeLastTerminal: z.record(z.string(), z.string()).default({}),
  /** Sidebar collapse state for each worktree group, keyed by
   * scopeId. Default empty = all groups expanded. */
  worktreeGroupCollapsed: z.record(z.string(), z.boolean()).default({}),
  /** What the center pane currently shows. The workspaceId only
   * exists on the `workspace` case so consumers can't accidentally
   * read a stale "last workspace" while the user is on the
   * onboarding screen — if you want the active workspace, you
   * have to acknowledge that there might not be one. */
  activeView: activeView.default({ kind: "onboarding" }),
  /** Pane layout per workspace. Tabs in a workspace's panes can
   * point at chats from any scope/worktree in that workspace; the
   * tab strip is therefore the unified "task view" for the
   * workspace. */
  workspacePanes: z.record(z.string(), workspacePaneState).default({}),
  /** Whether the workspace rail (the narrow column on the far left
   * that holds the workspace icons) is currently visible. Toggled
   * with ⌘⇧B. This one stays *window*-scoped because the rail
   * shows *all* workspaces — it's not part of any one workspace's
   * UI. */
  workspaceRailOpen: z.boolean().default(true),
  /** Per-workspace shell UI state. Keyed by workspaceId. See
   * `workspaceUiState` above for what lives here vs on the
   * per-scope record. */
  workspaceUiStates: z.record(z.string(), workspaceUiState).default({}),
  /** Per-scope shell UI state. Keyed by scopeId. See
   * `scopeUiState` above; this is where the right sidebar and
   * bottom panel's open/which-view/size bits live so they track
   * the active worktree the way their content already does. */
  scopeUiStates: z.record(z.string(), scopeUiState).default({}),
});

const fileTreeIndexStatus = z.enum(["idle", "indexing", "error"]);

const fileTreeIndex = z.object({
  scopeId: z.string(),
  directory: z.string(),
  paths: z.array(z.string()),
  status: fileTreeIndexStatus,
  error: z.string().nullable(),
  indexedAt: z.number(),
  truncated: z.boolean(),
});

const terminal = z.object({
  id: z.string(),
  scopeId: z.string(),
  cwd: z.string(),
  title: z.string(),
  createdAt: z.number(),
});

const theme = z.enum(["light", "dark", "oled", "system"]);

const modelInfo = z.object({
  provider: z.string(),
  id: z.string(),
  name: z.string(),
  api: z.string(),
  reasoning: z.boolean(),
  thinkingLevelMap: z.record(z.string(), z.string().nullable()).nullable(),
  input: z.array(z.string()),
  contextWindow: z.number(),
  maxTokens: z.number(),
});

/**
 * Per-session metadata cache. Keyed by `sessionId` in
 * `root.app.sessionMeta`. Anything we want indexable from the
 * sidebar / tab strip without paying for the lazy `eventLog`
 * collection lives here.
 *
 * Fields are independent of each other — they each have their own
 * write path and lifetime:
 *
 *   - `summary`: AI-generated title produced by a cheap LLM on every
 *     prompt. Null until the first summary lands, and may stay null
 *     if summarization keeps failing / the input keeps being
 *     unsummarizable. Branches that revisit an older user message
 *     show the *latest* prompt's summary (known limitation).
 *   - `lastMessageSentTime`: wall-clock time of the most recent user
 *     message dispatched to pi (direct prompt, queued message, or
 *     send-queued-now). Stamped on every prompt regardless of
 *     summarizer outcome. Drives the sidebar's "Recent activity"
 *     sort.
 */
const sessionMeta = z.object({
  sessionId: z.string(),
  summary: z
    .object({
      text: z.string(),
      model: z.string(),
      generatedAt: z.number(),
    })
    .nullable(),
  lastMessageSentTime: z.number(),
});

const chatBackground = z.object({
  blobId: z.string(),
  mimeType: z.string(),
  opacity: z.number(),
});

/**
 * Tab state for the standalone chat-window view. Keyed by the
 * Electron windowId. `tabs` is the ordered list of chatIds rendered
 * in the tab strip; `activeChatId` names which tab's chat is in the
 * pane. The chat-window stays open as long as `tabs` is non-empty.
 */
const chatWindowState = z.object({
  tabs: z.array(z.string()).default([]),
  activeChatId: z.string().nullable().default(null),
})

const sidebarChatSort = z.enum(["created", "lastMessage"])

/**
 * Process-level environment info we want available to the renderer
 * without an RPC round-trip. Currently just the user's home dir so
 * the chat UI can collapse absolute paths to `~/...`. Populated by
 * InitService on every boot.
 */
const env = z.object({
  homeDir: z.string().nullable().default(null),
});

// Which IDE on disk a `recentProject` entry was discovered in.
// Pulled from VS Code-derived IDEs' on-disk caches:
//   ~/Library/Application Support/<App>/User/globalStorage/state.vscdb
// for the recent list, and matching
//   ~/Library/Application Support/<App>/User/workspaceStorage/<hash>/workspace.json
// dirs for per-IDE "last opened" mtimes. `RecentProjectsService`
// adds new sources here whenever it grows support for another fork.
const recentProjectSource = z.enum([
  "code",
  "cursor",
  "windsurf",
  "antigravity",
  "trae",
]);

/**
 * A folder the user has recently opened in some other IDE on this
 * machine. Populated by RecentProjectsService (main process)
 * by reading each IDE's state.vscdb + workspaceStorage dirs,
 * then merging by absolute path.
 *
 * Surfaced in the onboarding view as "one-click open project" so
 * the user doesn't have to navigate the folder picker for the
 * 100% common case of "the project I was just in over there".
 */
const recentProject = z.object({
  /** Stable id = sha1(path); lets us key the record without
   * embedding the path itself in the key (which would make path
   * containing characters like `.` awkward in object spreads). */
  id: z.string(),
  /** Absolute local path. Always a real directory at the moment
   * the record was written — the service drops entries whose
   * path stops existing on disk. */
  path: z.string(),
  /** `path.basename(path)`. Denormalized so the renderer can list
   * entries without re-running path logic. */
  name: z.string(),
  /** Last time this folder was opened in *any* of the discovered
   * IDEs, in unix millis. Max across `sources`. */
  lastOpenedAt: z.number(),
  /** Which IDEs this folder showed up in. Useful for showing a
   * little badge per entry, and for telemetry-free debugging
   * of why something showed up. */
  sources: z.array(recentProjectSource),
});

/**
 * What "Enter" does in the composer while the agent is streaming.
 * Steer interjects before the agent's next LLM call; followUp queues
 * the message to run after the current turn finishes. Mod-Enter and
 * the `/steer` slash command always force steer; the `/queue` slash
 * command always forces followUp. This setting only kicks in for the
 * plain Enter path. When idle (no run in flight), it's ignored and
 * the message goes out as a regular prompt.
 */
const defaultSendMode = z.enum(["steer", "followUp"])

/**
 * A Pi extension contributed by a zenbu plugin. Lives in this DB
 * collection so the registry is observable (a future marketplace UI
 * can `useDb(root => root.app.piExtensions)` to list what's loaded).
 *
 * Registrations are runtime-only: `PiExtensionRegistryService` wipes
 * this record on every `evaluate()` and plugins re-register from
 * their own service setups, so a removed plugin never leaves a
 * dangling path here.
 *
 * `path` must be an absolute filesystem path to the extension's
 * entry `.ts` file. `SessionsService` reads `Object.values(...)`
 * and feeds the paths into `DefaultResourceLoader.additionalExtensionPaths`
 * when activating a session.
 */
/**
 * One log line from a play-button run. We store stdout, stderr,
 * and synthetic "system" messages (start/setup/exit banners) in
 * the same stream so the renderer can render them in one timeline.
 * `runId` tags which run the line belongs to — the UI uses it to
 * group lines into sessions and to know when to reset the URL
 * footer.
 */
const playLogItem = z.object({
  ts: z.number(),
  stream: z.enum(["stdout", "stderr", "system"]),
  data: z.string(),
  runId: z.string(),
})

/**
 * Per-workspace play-button config + live process state. Owned by
 * `PlayService`. The renderer's play button reads `isRunning` to
 * choose between the play/stop icon, and `startCommand` to know
 * whether the workspace has ever been configured (empty string =
 * "not configured yet, show the setup form").
 *
 * `setupCompletedScopeIds` is the list of scope ids the setup
 * command has successfully exited 0 in. Setup is per-scope (each
 * scope is its own worktree / directory and has to be
 * independently bootstrapped — e.g. `pnpm install` writes a
 * `node_modules/` into the scope's directory, not the
 * workspace's), so we track which scopes have been set up rather
 * than a single workspace-wide flag. Any subsequent `saveConfig`
 * call that touches `setupCommand` clears the list so every
 * scope re-runs setup against the new command. If `setupCommand`
 * is null the workspace is treated as "setup-not-needed" and we
 * go straight to start.
 *
 * `isRunning` / `currentRunId` are runtime mirrors. On startup
 * `PlayService.evaluate()` resets them to false/null because the
 * in-memory process map is gone — TODO: drop this manual reset
 * once core grows the "service-only / not synced to disk"
 * database state we keep talking about.
 */
const playConfig = z.object({
  workspaceId: z.string(),
  setupCommand: z.string().nullable().default(null),
  startCommand: z.string().default(""),
  /** Scope ids that have successfully run the configured setup
   * command against the current `setupCommand`. Cleared whenever
   * `setupCommand` changes (see `saveConfig`). A scope that's
   * missing from this list will re-run setup the next time the
   * user clicks Run from it. */
  setupCompletedScopeIds: z.array(z.string()).default([]),
  isRunning: z.boolean().default(false),
  currentRunId: z.string().nullable().default(null),
  currentRunStartedAt: z.number().nullable().default(null),
  logs: collection(playLogItem, { debugName: "play-logs" }),
})

const piExtension = z.object({
  id: z.string(),
  path: z.string(),
  meta: z
    .object({
      label: z.string().optional(),
      pluginName: z.string().optional(),
    })
    .default({}),
});

const settings = z.object({
  theme: theme,
  chatBackground: chatBackground.nullable().default(null),
  vimMode: z.boolean().default(true),
  sidebarChatSort: sidebarChatSort.default("created"),
  defaultSendMode: defaultSendMode.default("followUp"),
});

/**
 * records are kinda like tables with a single index built in
 *
 * ideally we could just use arrays, but records allow for O(1)
 * mutations, and array mutations in the DB is O(N)
 */
const schema = createSchema({
  repos: z.record(z.string(), repo).default({}),
  workspaces: z.record(z.string(), workspace).default({}),
  scopes: z.record(z.string(), scope).default({}),
  chats: z.record(z.string(), chat).default({}),
  sessions: z.record(z.string(), session).default({}),
  windowStates: z.record(z.string(), windowState).default({}),
  chatStates: z.record(z.string(), chatState).default({}),
  terminals: z.record(z.string(), terminal).default({}),
  fileTreeIndexes: z.record(z.string(), fileTreeIndex).default({}),
  models: z.record(z.string(), modelInfo).default({}),
  sessionMeta: z.record(z.string(), sessionMeta).default({}),
  chatWindows: z.record(z.string(), chatWindowState).default({}),
  /** Registry of Pi extensions contributed by zenbu plugins.
   * Keyed by `id`. Wiped on every app start by
   * `PiExtensionRegistryService.evaluate()` and re-populated by
   * plugins from their own service `setup()` blocks. */
  piExtensions: z.record(z.string(), piExtension).default({}),
  /** Per-workspace play-button config + live run state. Keyed by
   * `workspaceId`. Created lazily by `PlayService` the first time
   * a workspace opens its play popover. The `logs` field on each
   * entry is a collection ref initialised at create time. */
  playConfigs: z.record(z.string(), playConfig).default({}),
  /** Folders the user has recently opened in other IDEs on this
   * machine, indexed by sha1(path). Populated entirely by
   * `RecentProjectsService` on every app boot — the service
   * truncates and rewrites this record, so anything stale (path
   * deleted, IDE uninstalled) disappears on next launch. */
  recentProjects: z.record(z.string(), recentProject).default({}),
  env: env.default({ homeDir: null }),
  settings: settings.default({
    theme: "system",
    chatBackground: null,
    vimMode: true,
    sidebarChatSort: "created",
    defaultSendMode: "followUp",
  }),
});

export default schema;
export type Schema = InferSchemaRoot<typeof schema>;
