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

const leftSidebarTab = z.enum(["agent", "pi-sessions"]);

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

const windowState = z.object({
  /** Primary workspace selection axis. Pane layout, the chat being
   * shown, the active worktree, etc. all derive from this + the
   * active tab inside `workspacePanes[selectedWorkspaceId]`. */
  selectedWorkspaceId: z.string().nullable().default(null),
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
  leftSidebarTab: leftSidebarTab.default("agent"),
  /** Pane layout per workspace. Tabs in a workspace's panes can
   * point at chats from any scope/worktree in that workspace; the
   * tab strip is therefore the unified "task view" for the
   * workspace. */
  workspacePanes: z.record(z.string(), workspacePaneState).default({}),
  /** Which bottom-panel view is currently active in this window.
   * Null means "fall back to the default" (the first registered
   * bottom-panel view, typically `terminal`). The panel itself can
   * still be collapsed; that's local UI state, not persisted. */
  bottomPanelView: z.string().nullable().default(null),
  /** Whether the left sidebar is currently expanded in this window.
   * Persisted so a renderer reload doesn't reset it. */
  leftSidebarOpen: z.boolean().default(true),
  /** Whether the workspace rail (the narrow column on the far left
   * that holds the workspace icons) is currently visible. Toggled
   * with ⌘⇧B. */
  workspaceRailOpen: z.boolean().default(true),
  /** Which right-sidebar view is currently open in this window, or
   * `null` when the right sidebar is collapsed. */
  rightSidebarOpenType: z.string().nullable().default(null),
  /** The last right-sidebar view the user picked, so closing +
   * reopening the right sidebar restores it instead of landing on
   * the first registered view. */
  rightSidebarLastType: z.string().nullable().default(null),
  /** Whether the bottom panel (terminal/etc.) is currently expanded
   * in this window. */
  bottomPanelOpen: z.boolean().default(false),
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
