import { collection, z } from "@zenbujs/core/db";

// ---------------------------------------------------------------------------
// Git repos & worktrees
// ---------------------------------------------------------------------------

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

export const repo = z.object({
  id: z.string(),
  commonDir: z.string(),
  mainWorktreePath: z.string(),
  worktrees: z.array(worktree),
  branches: z.array(branch),
  syncedAt: z.number(),
});

// ---------------------------------------------------------------------------
// Workspace (the user-facing grouping shown in the workspace rail)
// ---------------------------------------------------------------------------

const workspaceIcon = z.object({
  blobId: z.string(),
  mimeType: z.string(),
});

/**
 * Auto-derived workspace icon — the result of scanning the
 * workspace's directory for a `favicon.*` / `logo.*` / `icon.*`
 * file and inlining it into blob storage. Kept in a separate
 * field from `icon` (the user upload) so the two have independent
 * lifecycles:
 *
 *   - User upload always wins in the resolution chain.
 *   - "Clear icon" on the user upload falls back to this auto one
 *     instead of dropping to the letter tile.
 *   - Re-discovery (e.g. the user adds a favicon to a repo that
 *     didn't have one when the workspace was first created)
 *     doesn't have to think about clobbering a user choice.
 *
 * Mirrors OpenCode's `{ url, override, color }` shape where `url`
 * is auto-derived and `override` is user-supplied — we use
 * separate fields rather than discriminating on a boolean so the
 * "user upload over auto" stacking is explicit at the type level.
 */
const workspaceIconAuto = z.object({
  blobId: z.string(),
  mimeType: z.string(),
  /** Path of the source file relative to the workspace's
   * directory. Stored for debugging / future "re-derive from a
   * different file" UI; not used by the renderer. */
  sourcePath: z.string(),
  /** Wall-clock time (unix ms) the discovery scan that produced
   * this icon completed. */
  discoveredAt: z.number(),
});

export const workspace = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.number(),
  icon: workspaceIcon.nullable().default(null),
  /** Auto-derived icon from scanning the workspace directory.
   * Resolved underneath `icon` (the user upload) — see
   * `useWorkspaceIconUrl`. Populated by `WorkspaceIconService`
   * on workspace creation and lazily during boot-time backfill. */
  iconAuto: workspaceIconAuto.nullable().default(null),
  /** Flips to true once `WorkspaceIconService.discover` has run
   * for this workspace, regardless of whether the scan found
   * anything. Used to short-circuit subsequent discovery passes
   * so we don't re-walk the directory on every boot. The user
   * can force a re-scan via `rediscover()` (flips this back to
   * false and re-runs). */
  iconAutoAttempted: z.boolean().default(false),
  archived: z.boolean().default(false),
  /**
   * Workspace flavor.
   *
   *   - `"default"` is the everyday case: a project workspace
   *     shown in the workspace rail.
   *   - `"plugin"` marks the workspace as backing a plugin's
   *     "Edit in workspace" window (one per plugin, created
   *     lazily by `PluginsRootViewService.ensurePluginWorkspace`).
   *     These are filtered out of the workspace rail and are
   *     reached through the plugins sidebar instead.
   *
   * Future work can hang per-flavor onboarding / UI off this
   * discriminator.
   */
  kind: z.enum(["default", "plugin"]).default("default"),
  /** Default source ref the "Create worktree" dialog branches off
   * when the user hasn't picked one. `null` falls back to the main
   * worktree's current branch. */
  defaultWorktreeBranch: z.string().nullable().default(null),
});

// ---------------------------------------------------------------------------
// Scope (a single worktree inside a workspace)
// ---------------------------------------------------------------------------

export const scope = z.object({
  id: z.string(),
  workspaceId: z.string(),
  directory: z.string(),
  repoId: z.string().nullable(),
  extraDirectories: z.array(z.string()),
  createdAt: z.number(),
  /** Soft-delete: hides scope from the sidebar; data is preserved.
   * "Import Worktrees" un-archives matching scopes. The (now
   * removed) `completed` concept folded into this single archive
   * bucket — migration 73 backfills `archived = true` for any
   * row that was previously `completed = true`. */
  archived: z.boolean().default(false),
  /** Unix ms the scope was most recently archived, or null. Used
   * to sort archived worktrees without joining sessions/chats. */
  archivedAt: z.number().nullable().default(null),
  /** Unix ms the scope was most recently pinned, or null. Multiple
   * scopes can be pinned; sorted by `pinnedAt` desc. The main
   * worktree is auto-pinned on first materialization. */
  pinnedAt: z.number().nullable().default(null),
  /** Unix ms the scope was most recently unpinned. Used as the
   * priority sort key for the unpinned section:
   * `priority = max(unpinnedAt ?? 0, createdAt)` so a freshly
   * unpinned scope bubbles to the top of the unpinned group. */
  unpinnedAt: z.number().nullable().default(null),
  /** Set when the scope was materialized by "Create Plugin": its
   * directory is a worktree under `~/.zenbu/plugin-worktrees/<name>`
   * and `extraDirectories` includes `~/.zenbu/plugins/<name>`.
   * Null for regular worktrees. */
  pluginName: z.string().nullable().default(null),
});

// ---------------------------------------------------------------------------
// Per-scope resources: terminals + the file-tree index used by `@`-pills
// ---------------------------------------------------------------------------

export const terminal = z.object({
  id: z.string(),
  scopeId: z.string(),
  cwd: z.string(),
  title: z.string(),
  createdAt: z.number(),
});

const fileTreePathItem = z.object({
  path: z.string(),
});

export const fileTreeIndex = z.object({
  scopeId: z.string(),
  directory: z.string(),
  /** Indexed file paths for the scope. Stored in a collection so
   * re-indexing 20k paths doesn't rewrite a giant array into
   * `root.json` on every chunk. */
  paths: collection(fileTreePathItem, { debugName: "file-tree-paths" }),
  status: z.enum(["idle", "indexing", "error"]),
  error: z.string().nullable(),
  indexedAt: z.number(),
  truncated: z.boolean(),
});

// The play-button config used to live here as `playConfig`. It
// moved to `plugins/play/src/main/schema.ts` along with the rest
// of the Play plugin. Migration `0046` drops the host's
// `app.playConfigs` record.
