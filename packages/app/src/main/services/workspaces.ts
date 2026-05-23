import path from "node:path"
import { nanoid } from "nanoid"
import { Service } from "@zenbujs/core/runtime"
import { DbService } from "@zenbujs/core/services"
import { ReposService } from "./repos"
import { SessionsService } from "./sessions"
import type { Schema } from "../schema"

type WindowState = Schema["windowStates"][string]
type WorkspacePaneState = WindowState["workspacePanes"][string]

/**
 * Owns the "create a workspace from a directory" flow.
 *
 * Lives main-side specifically because creating a workspace is a
 * compound operation:
 *
 *   1. `repos.detectAndSync(directory)` to (idempotently) materialize
 *      the git repo row.
 *   2. Write the workspace + scope + chat + per-window pane state to
 *      the DB.
 *   3. `sessions.createChatSession(...)` to flip the chat from
 *      `pending` to `ready`.
 *
 * Step 3 reads the scope and chat written in step 2. If step 2 ran
 * in the renderer (as it used to), the renderer's `client.update`
 * resolves once the *central* cache has the write — but main's
 * local replica receives the write via a `replicated-write`
 * broadcast which is dispatched *after* the ack is sent. There's a
 * real window where `root.app.scopes[scopeId]` is undefined on
 * main even though the renderer "saw" its own update. Polling that
 * window away is masking a layering bug; doing all writes on the
 * same side as the subsequent read is the deterministic fix.
 *
 * Pulling steps 2 and 3 into a single main-side service method
 * collapses the race: main's `db.client` is in-process with the
 * server, so writes hit the central cache directly and are
 * immediately visible to the next `readRoot()` on the same side.
 * The renderer just awaits the RPC; UI updates flow back via the
 * normal sync broadcast.
 */
export class WorkspacesService extends Service.create({
  key: "workspaces",
  deps: {
    db: DbService,
    repos: ReposService,
    sessions: SessionsService,
  },
}) {
  /**
   * Create a workspace anchored at `directory`, focus it in
   * `windowId`, and return ids for the renderer to reference.
   *
   * `windowId` is the calling window. We need it so the new
   * workspace becomes the active view *in that window* (without
   * disturbing other open windows). It comes from the renderer's
   * `useWindowId()` and is opaque to us.
   *
   * Throws on detect/sync failure — the onboarding screen already
   * wraps callers in `try { ... } catch(err) { setError(...) }`,
   * so a propagated error surfaces inline instead of leaving the
   * user with a half-built workspace.
   */
  async createFromDirectory(args: {
    directory: string
    windowId: string
  }): Promise<{
    workspaceId: string
    scopeId: string
    chatId: string
    sessionId: string
  }> {
    const { repoId } = await this.ctx.repos.detectAndSync({
      directory: args.directory,
    })

    const workspaceId = nanoid()
    const scopeId = nanoid()
    const chatId = nanoid()
    const paneId = nanoid()
    const tabId = nanoid()
    const now = Date.now()
    const name = path.basename(args.directory) || "Workspace"

    await this.ctx.db.client.update(root => {
      // Workspace + scope + chat. Mirrors the literal shape the
      // renderer hook used to write so existing observers
      // (sidebar, workspace rail, chat-pane-container) keep
      // working unchanged. The first scope of a brand-new
      // workspace is always the anchor — we pin it at `now` so
      // the sidebar has a stable top row.
      root.app.workspaces[workspaceId] = {
        id: workspaceId,
        name,
        createdAt: now,
        icon: null,
        archived: false,
        sentinel: false,
      }
      root.app.scopes[scopeId] = {
        id: scopeId,
        workspaceId,
        directory: args.directory,
        repoId,
        extraDirectories: [],
        createdAt: now,
        archived: false,
        completed: false,
        archivedAt: null,
        completedAt: null,
        pinnedAt: now,
        unpinnedAt: null,
        pluginName: null,
      }
      root.app.chats[chatId] = {
        id: chatId,
        scopeId,
        session: { kind: "pending" },
        createdAt: now,
      }

      // Window pointer — switch this window onto the new
      // workspace and seed a one-pane / one-tab layout with the
      // new chat focused. Used to live in the renderer's
      // `selectChatInRoot`; pulling it into the same main-side
      // write is what eliminates the race with `createChatSession`
      // below.
      const ws = ensureWindowState(root, args.windowId)
      ws.activeView = { kind: "workspace", workspaceId }
      ws.selectedScopeId = scopeId
      const initialContent = { kind: "chat" as const, chatId }
      const paneState: WorkspacePaneState = {
        panes: [
          {
            id: paneId,
            tabs: [
              {
                id: tabId,
                content: initialContent,
                history: { entries: [initialContent], index: 0 },
              },
            ],
            activeTabId: tabId,
          },
        ],
        activePaneId: paneId,
      }
      ws.workspacePanes[workspaceId] = paneState
    })

    // Same process, same replica. `createChatSession` will read
    // the scope and chat we just wrote without going through any
    // sync boundary.
    const { sessionId } = await this.ctx.sessions.createChatSession({
      scopeId,
      chatId,
    })

    return { workspaceId, scopeId, chatId, sessionId }
  }
}

/**
 * Local mirror of the renderer's `ensureWindowState`. Kept inline
 * so this service doesn't import `lib/window-state.ts` (a renderer
 * module that pulls in React). The two are intentionally
 * structurally identical — if you change one, update the other.
 */
function ensureWindowState(
  root: { app: { windowStates: Record<string, WindowState> } },
  windowId: string,
): WindowState {
  const existing = root.app.windowStates[windowId]
  if (existing) {
    if (!existing.scopeLastTerminal) existing.scopeLastTerminal = {}
    if (!existing.workspacePanes) existing.workspacePanes = {}
    if (!existing.worktreeGroupCollapsed)
      existing.worktreeGroupCollapsed = {}
    if (!existing.workspaceUiStates) existing.workspaceUiStates = {}
    if (!existing.scopeUiStates) existing.scopeUiStates = {}
    return existing
  }
  const fresh: WindowState = {
    selectedScopeId: null,
    scopeLastTerminal: {},
    worktreeGroupCollapsed: {},
    activeView: { kind: "onboarding" },
    workspacePanes: {},
    workspaceRailOpen: true,
    workspaceUiStates: {},
    scopeUiStates: {},
  }
  root.app.windowStates[windowId] = fresh
  return fresh
}
