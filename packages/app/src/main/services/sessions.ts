import os from "node:os"
import path from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { fileURLToPath } from "node:url"
import dotenv from "dotenv"

const execFileP = promisify(execFile)
import { Service } from "@zenbujs/core/runtime"
import { DbService, RpcService } from "@zenbujs/core/services"
import { summarizeUserMessage } from "../summaries/summarize-user-message"
import { SummariesService } from "./summaries"
import {
  AuthStorage,
  type AgentSessionEvent,
  type AgentSession,
  type CreateAgentSessionOptions,
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRegistry,
  SessionManager,
} from "@earendil-works/pi-coding-agent"
import {
  collectExtraAgentsFiles,
  formatExtraDirsPrompt,
} from "../lib/extra-dirs"
import { PiExtensionRegistryService } from "./pi-extension-registry"
import { ReposService } from "./repos"
import { SessionActivityService } from "./session-activity"
import type { ImageContent, TextContent } from "@earendil-works/pi-ai"
import { nanoid } from "nanoid"

type ImageRef = { blobId: string; mimeType: string }
type QueueKind = "steer" | "followUp"
type QueuedDraft = {
  id: string
  text: string
  images: ImageRef[]
  editorState: unknown
  createdAt: number
  kind: QueueKind
}

dotenv.config({
  path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.env"),
  quiet: true,
})

import type { Schema } from "../schema"

type Session = Schema["sessions"][string]
type ModelInfo = Schema["models"][string]
type EventItem = { seq: number; kind: string; payload: unknown; timestamp: number }

type ProviderModelRef = { provider: string; id: string }

const PI_SESSION_DIR = path.join(os.homedir(), ".hackable-gui", "pi-sessions")

/**
 * Tracks what's expected from pi's next user `message_end` event.
 *   preStaged  — we already appended a `user_prompt` to the event
 *                  log (`prompt()` path), so the matching pi event
 *                  is a no-op for materialization.
 *   synthesize — the message was dispatched as a queued or steer
 *                  item; pi will emit `message_end` when it delivers
 *                  it, and that's our cue to append a `user_prompt`
 *                  event so the chat surface renders the bubble.
 *
 * Carried out-of-band on `LiveSession` because pi events don't carry
 * the display text (with image-pill placeholders) or the imageRef
 * metadata we need to render the user-message bubble.
 */
type ExpectedUserMessage =
  | { kind: "preStaged" }
  | { kind: "synthesize"; displayText: string; imageRefs: ImageRef[] }

class LiveSession {
  seq = 0
  readonly subscribers = new Set<string>()
  /** FIFO mirror of user messages we've sent to pi but haven't yet
   * seen a `message_end` for. Shifted on each pi user `message_end`.
   * See `ExpectedUserMessage` for what each entry means. */
  expectedUserMessages: ExpectedUserMessage[] = []
  /** Stamped whenever a concat against this session's eventLog
   * rejects. `peekEventLogTail` surfaces it so the invariant
   * report can tell apart "write actually failed" from "renderer
   * subscription dropped". */
  lastConcatError: { when: number; message: string } | null = null
  /** Last-seen snapshot of the owning scope's `extraDirectories`.
   * The scope-subscription handler diffs against this to figure out
   * which dirs were added or removed when the user (or another
   * service) mutates the scope mid-session. Initialised at
   * `activate()` time. */
  extraDirsSnapshot: readonly string[] = []
  /** Cleanup callbacks registered alongside the pi subscription. Run
   * in order on `dispose()`. Used for things like the db subscription
   * that watches `extraDirectories` — their lifetime is the same as
   * the live pi session. */
  private readonly extraDisposers: Array<() => void> = []
  private readonly unsubscribePi: () => void

  constructor(
    readonly sessionId: string,
    readonly pi: AgentSession,
    onEvent: (live: LiveSession, event: AgentSessionEvent) => void,
  ) {
    this.unsubscribePi = pi.subscribe(event => onEvent(this, event))
  }

  addDisposer(fn: () => void) {
    this.extraDisposers.push(fn)
  }

  dispose() {
    this.unsubscribePi()
    for (const fn of this.extraDisposers.splice(0)) {
      try {
        fn()
      } catch (err) {
        console.warn("[sessions] disposer threw:", err)
      }
    }
    this.pi.dispose()
  }
}

export class SessionsService extends Service.create({
  key: "sessions",
  deps: {
    db: DbService,
    summaries: SummariesService,
    rpc: RpcService,
    piExtensionRegistry: PiExtensionRegistryService,
    repos: ReposService,
    sessionActivity: SessionActivityService,
  },
}) {
  private readonly live = new Map<string, LiveSession>()
  private readonly activating = new Map<string, Promise<LiveSession>>()
  private readonly auth = AuthStorage.create()
  private readonly models = ModelRegistry.create(this.auth)

  async evaluate() {
    await this.ctx.db.client.update(root => {
      for (const id of Object.keys(root.app.sessions)) {
        const s = root.app.sessions[id]
        if (!s) continue
        s.isStreaming = false
        s.queue = { steering: [], followUp: [] }
        s.subscriberCount = 0
        // HACK: backfill nested queue fields for sessions persisted
        // before these fields existed in the schema. Migration 0018
        // bumped the typeHash without backfilling, so older DBs that
        // already advanced past it have sessions missing these.
        // Delete this once we reset migrations.
        if (!Array.isArray(s.queueDraft)) s.queueDraft = []
        // Pi processes were torn down. Any items previously in pi's
        // queue are gone, and we no longer have a pause/resume
        // mechanism to hold them client-side, so just drop the
        // shadow. The user can re-queue if they still want them.
        if (s.queueDraft.length > 0) s.queueDraft = []
      }
    })

    await this.refreshAvailableModels()

    this.setup("dispose-live", () => () => {
      for (const live of this.live.values()) live.dispose()
      this.live.clear()
    })
  }

  async refreshAvailableModels(): Promise<void> {
    this.models.refresh()
    const available = this.models.getAvailable()
    const next: Record<string, ModelInfo> = {}
    for (const m of available) {
      const key = `${m.provider}/${m.id}`
      let thinkingLevelMap: ModelInfo["thinkingLevelMap"] = null
      if (m.thinkingLevelMap) {
        const map: Record<string, string | null> = {}
        for (const [level, value] of Object.entries(m.thinkingLevelMap)) {
          if (value === undefined) continue
          map[level] = value
        }
        thinkingLevelMap = map
      }
      next[key] = {
        provider: m.provider,
        id: m.id,
        name: m.name,
        api: m.api,
        reasoning: m.reasoning,
        thinkingLevelMap,
        input: [...m.input],
        contextWindow: m.contextWindow,
        maxTokens: m.maxTokens,
      }
    }
    await this.ctx.db.client.update(root => {
      root.app.models = next
    })
  }

  async createChatSession(args: {
    scopeId: string
    chatId: string
    parentSessionId?: string
    parentEntryId?: string
    title?: string
  }): Promise<{ sessionId: string }> {
    const root = this.ctx.db.client.readRoot()
    const scope = root.app.scopes[args.scopeId]
    if (!scope) {
      throw new Error(`unknown scope ${args.scopeId}`)
    }
    const chat = root.app.chats[args.chatId]
    if (!chat) {
      throw new Error(`unknown chat ${args.chatId}`)
    }
    if (chat.session.kind === "ready") {
      return { sessionId: chat.session.sessionId }
    }

    const sm = SessionManager.create(scope.directory, PI_SESSION_DIR)
    const sessionId = sm.getSessionId()
    const sessionFile = sm.getSessionFile()
    if (!sessionFile) {
      throw new Error("SessionManager did not produce a session file")
    }
    // Force pi's SessionManager to write the session header to disk
    // NOW, before we discard `sm`. Without this, the file stays
    // in-memory-only until something appends an entry, and our
    // recorded `piSessionId` / `sessionFile` point at a path that
    // doesn't exist on disk yet.
    //
    // The trouble that causes: the next `ensureLive(sessionId)`
    // calls `SessionManager.open(record.sessionFile, …)`, which
    // sees an empty/missing file and falls into pi's
    // "empty-or-corrupted, generate a fresh session id" recovery
    // branch. The result: the live runtime's in-memory sessionId
    // is a NEW UUID (created 30–40ms later) while our DB record
    // still has the original. Everything else on top of that
    // (clone, prompts, navigateTree, eventLog appends) operates
    // against a corrupted runtime — see the
    // `runtime_session_manager_mutated` invariant verdict.
    //
    // `_rewriteFile` is technically private on pi's class, but it's
    // the only call that does what we need here. Pi has no public
    // "flush header" method as of 0.74.0. Keep this cast confined
    // to this site so the rest of the service stays type-safe.
    flushSessionManagerHeader(sm)

    // fixme: this should be using make collection api
    const eventLogRef = {
      collectionId: nanoid(),
      debugName: `events-${sessionId}`,
    }

    const record: Session = {
      id: sessionId,
      scopeId: args.scopeId,
      parentSessionId: args.parentSessionId ?? null,
      parentEntryId: args.parentEntryId ?? null,
      title: args.title ?? "Untitled",
      sessionFile,
      piSessionId: sessionId,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      archived: false,
      model: null,
      thinkingLevel: "medium",
      isStreaming: false,
      currentLeafEntryId: null,
      queue: { steering: [], followUp: [] },
      queueDraft: [],
      subscriberCount: 0,
      leafCount: 1,
      branchSummary: null,
      stats: emptyStats(),
      runStartContextTokens: null,
      lastOpenedAt: null,
      lastCompletedAt: null,
      eventLog: eventLogRef as Session["eventLog"],
    }

    await this.ctx.db.client.update(root => {
      root.app.sessions[sessionId] = record
      const chatRecord = root.app.chats[args.chatId]
      if (chatRecord) {
        chatRecord.session = { kind: "ready", sessionId }
      }
    })

    return { sessionId }
  }

  async fork(args: {
    sessionId: string
    entryId: string
    workspaceId: string
    title?: string
  }): Promise<{ sessionId: string; chatId: string; scopeId: string }> {
    const parent = this.requireRecord(args.sessionId)
    const live = await this.ensureLive(args.sessionId)
    live.pi.sessionManager.branch(args.entryId)

    const parentScope =
      this.ctx.db.client.readRoot().app.scopes[parent.scopeId]
    if (!parentScope) {
      throw new Error(`unknown scope ${parent.scopeId}`)
    }

    const newSm = SessionManager.forkFrom(
      parent.sessionFile,
      parentScope.directory,
      PI_SESSION_DIR,
    )
    const childId = newSm.getSessionId()
    const childFile = newSm.getSessionFile()
    if (!childFile) {
      throw new Error("forked SessionManager did not produce a session file")
    }
    // Same persist-before-discard contract as createChatSession.
    flushSessionManagerHeader(newSm)

    const eventLogRef = {
      collectionId: nanoid(),
      debugName: `events-${childId}`,
    }

    const chatId = nanoid()
    const scopeId = parentScope.id

    await this.ctx.db.client.update(root => {
      root.app.sessions[childId] = {
        id: childId,
        scopeId,
        parentSessionId: parent.id,
        parentEntryId: args.entryId,
        title: args.title ?? `${parent.title} (fork)`,
        sessionFile: childFile,
        piSessionId: childId,
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
        archived: false,
        model: null,
        thinkingLevel: "medium",
        isStreaming: false,
        currentLeafEntryId: null,
        queue: { steering: [], followUp: [] },
        queueDraft: [],
        subscriberCount: 0,
        leafCount: 1,
        branchSummary: null,
        stats: emptyStats(),
        runStartContextTokens: null,
        lastOpenedAt: null,
        lastCompletedAt: null,
        eventLog: eventLogRef as Session["eventLog"],
      }
      root.app.chats[chatId] = {
        id: chatId,
        scopeId,
        session: { kind: "ready", sessionId: childId },
        createdAt: Date.now(),
      }
    })

    return { sessionId: childId, chatId, scopeId }
  }

  /**
   * Duplicate the current session at the current leaf.
   *
   * Mirrors pi's `/clone` slash command (see
   * `agent-session-runtime.fork(leafId, { position: "at" })`):
   * we take the source session's linear path from root → current
   * leaf and write it as a brand-new session file via
   * `SessionManager.createBranchedSession(leafId)`. The result is a
   * standalone session that starts with an exact copy of the
   * conversation history up to here, with no shared mutation state.
   *
   * Returns a fresh `sessionId` + `chatId` + `scopeId`. Caller is
   * expected to swap the active tab's chat to the new `chatId` so
   * the user immediately sees the cloned session (the cloning act
   * itself does NOT change pi state on the source session).
   */
  async clone(args: {
    sessionId: string
    title?: string
  }): Promise<{ sessionId: string; chatId: string; scopeId: string }> {
    const parent = this.requireRecord(args.sessionId)
    const live = await this.ensureLive(args.sessionId)
    const leafId = live.pi.sessionManager.getLeafId()
    if (!leafId) {
      throw new Error("Cannot clone: session has no current entry")
    }
    const parentScope =
      this.ctx.db.client.readRoot().app.scopes[parent.scopeId]
    if (!parentScope) {
      throw new Error(`unknown scope ${parent.scopeId}`)
    }
    // CRITICAL: `createBranchedSession` mutates the SessionManager it
    // is called on — it overwrites `sessionId`, `sessionFile`, and
    // `fileEntries` in place, then rebuilds the index. If we call it
    // on `live.pi.sessionManager`, the *parent*'s live pi runtime
    // ends up pointing at the child's file with the child's id, and
    // every subsequent prompt/append on the parent silently operates
    // on the child file. Symptom: send a message in the OG chat
    // post-clone and watch the renderer drift permanently out of
    // sync with the eventLog — the underlying pi is corrupted.
    //
    // Open a throwaway SessionManager from the parent's file on
    // disk and call createBranchedSession on THAT instead. The live
    // parent runtime stays untouched. This matches what pi's own
    // `fork()` does internally.
    const sourceSm = SessionManager.open(parent.sessionFile, PI_SESSION_DIR)
    const newPath = sourceSm.createBranchedSession(leafId)
    if (!newPath) {
      throw new Error(
        "createBranchedSession returned undefined (session not persisted?)",
      )
    }
    const newSm = SessionManager.open(newPath, PI_SESSION_DIR)
    const childId = newSm.getSessionId()
    const childFile = newSm.getSessionFile()
    if (!childFile) {
      throw new Error("cloned SessionManager did not produce a session file")
    }
    // Same persist-before-discard contract as createChatSession.
    // Note: `sourceSm.createBranchedSession` already wrote the
    // file IF the branch contains an assistant message. If the
    // leaf is a user message, pi defers the write until first
    // assistant response — leaving the same empty-file hazard
    // we hit in createChatSession. Force-flush to close it.
    flushSessionManagerHeader(newSm)

    const eventLogRef = {
      collectionId: nanoid(),
      debugName: `events-${childId}`,
    }

    const chatId = nanoid()
    const scopeId = parentScope.id

    await this.ctx.db.client.update(root => {
      root.app.sessions[childId] = {
        id: childId,
        scopeId,
        parentSessionId: parent.id,
        parentEntryId: leafId,
        title: args.title ?? `${parent.title} (clone)`,
        sessionFile: childFile,
        piSessionId: childId,
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
        archived: false,
        model: parent.model,
        thinkingLevel: parent.thinkingLevel,
        isStreaming: false,
        currentLeafEntryId: null,
        queue: { steering: [], followUp: [] },
        queueDraft: [],
        subscriberCount: 0,
        leafCount: 1,
        branchSummary: null,
        stats: emptyStats(),
        runStartContextTokens: null,
        lastOpenedAt: null,
        lastCompletedAt: null,
        eventLog: eventLogRef as Session["eventLog"],
      }
      root.app.chats[chatId] = {
        id: chatId,
        scopeId,
        session: { kind: "ready", sessionId: childId },
        createdAt: Date.now(),
      }
    })

    // Activate pi on the cloned session and synthesize its event log
    // from the file we just wrote. Without this, the new chat shows
    // an empty surface even though the session file contains the
    // full root → leaf history — our materialize layer reads from
    // the eventLog collection, not directly from pi.
    //
    // `rebuildEventLogFromCurrentPath` walks `live.pi.messages`
    // (already populated by SessionManager.open on activation) and
    // emits the same kind of synthetic events the navigateTree path
    // produces, so the renderer sees a normal chat history
    // immediately.
    const childLive = await this.ensureLive(childId)
    await this.rebuildEventLogFromCurrentPath(childLive)

    // Stamp a synthetic `cloned_from` event at the tail of the new
    // eventLog so materialize.ts can render a divider in the chat
    // showing "this is where the clone happened". Lives in the
    // eventLog (not pi's session entries) because it's purely a
    // UI marker — pi has no concept of "this session was cloned".
    childLive.seq++
    const cloneEvent: EventItem = {
      seq: childLive.seq,
      kind: "cloned_from",
      payload: {
        parentSessionId: parent.id,
        parentTitle: parent.title,
        parentEntryId: leafId,
      },
      timestamp: Date.now(),
    }
    await this.safeConcatEventLog(childId, [cloneEvent], "clone marker")

    await this.syncRuntime(childLive)

    return { sessionId: childId, chatId, scopeId }
  }

  /**
   * Pi-style fork from a user message.
   *
   * The user picks a `user` message in the source session's tree.
   * We:
   *   1. Take the path root → parent-of-that-message and write it
   *      to a new session file via `createBranchedSession`. The
   *      picked message itself is NOT copied.
   *   2. Extract the picked message's text and stage it in the new
   *      chat's persisted draft so the composer auto-fills with it
   *      on first mount.
   *   3. In ONE db update: create the new session record, new chat
   *      record, set the chat's draft, and append a new tab
   *      containing that chat to the window's active pane.
   *
   * Effect: user types `/fork`, picks an old user message, lands in
   * a new tab with prior context already loaded and the picked
   * message text in the composer ready to edit and resend.
   *
   * Distinct from `clone`: clone keeps the picked entry (and its
   * assistant response) in the new session. Fork drops the picked
   * user message (and any descendants on the current path) so the
   * user can re-issue it differently.
   */
  async forkAtUserMessage(args: {
    sessionId: string
    /** Pi entry id of the user message to fork at. Must be a
     * `message` entry with `role === "user"`. */
    entryId: string
    /** Window id whose active pane should receive the new tab. */
    windowId: string
  }): Promise<{
    sessionId: string
    chatId: string
    scopeId: string
    editorText: string
  }> {
    const parent = this.requireRecord(args.sessionId)
    const parentScope =
      this.ctx.db.client.readRoot().app.scopes[parent.scopeId]
    if (!parentScope) {
      throw new Error(`unknown scope ${parent.scopeId}`)
    }
    // Look up the picked entry. We deliberately open a separate
    // SessionManager rather than touching the live one (see
    // clone()'s comment on why `createBranchedSession` mutates).
    const sourceSm = SessionManager.open(parent.sessionFile, PI_SESSION_DIR)
    const pickedEntry = sourceSm.getEntry(args.entryId) as
      | {
          id: string
          type: string
          parentId: string | null
          message?: { role?: string; content?: unknown }
        }
      | null
    if (!pickedEntry || pickedEntry.type !== "message") {
      throw new Error(`Entry ${args.entryId} is not a message entry`)
    }
    if (pickedEntry.message?.role !== "user") {
      throw new Error(
        `Entry ${args.entryId} is not a user message (role=${pickedEntry.message?.role})`,
      )
    }
    const editorText = extractTextContent(pickedEntry.message.content)
    // `position: "before"` semantics: new leaf is the PARENT of the
    // picked user message. `createBranchedSession(null)` resets to
    // a clean root, which is fine for the case where the picked
    // message was the very first user message in the session.
    const newLeafId = pickedEntry.parentId
    const newPath =
      newLeafId === null
        ? // No parent: forking before the first message produces an
          // empty session. createBranchedSession requires a real leaf
          // id, so synthesize an empty SessionManager directly.
          SessionManager.create(parentScope.directory, PI_SESSION_DIR).getSessionFile()
        : sourceSm.createBranchedSession(newLeafId)
    if (!newPath) {
      throw new Error(
        "could not produce a forked session file (source not persisted?)",
      )
    }
    const newSm = SessionManager.open(newPath, PI_SESSION_DIR)
    const childId = newSm.getSessionId()
    const childFile = newSm.getSessionFile()
    if (!childFile) {
      throw new Error("forked SessionManager did not produce a session file")
    }

    const eventLogRef = {
      collectionId: nanoid(),
      debugName: `events-${childId}`,
    }
    const chatId = nanoid()
    const scopeId = parentScope.id
    const tabId = nanoid()

    // SINGLE db update: session record + chat record + persisted
    // draft + new active tab. Everything the renderer needs to mount
    // the new chat with the forked message in the composer lands in
    // one transaction; the renderer sees no intermediate state.
    await this.ctx.db.client.update(root => {
      root.app.sessions[childId] = {
        id: childId,
        scopeId,
        parentSessionId: parent.id,
        parentEntryId: args.entryId,
        title: `${parent.title} (fork)`,
        sessionFile: childFile,
        piSessionId: childId,
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
        archived: false,
        model: parent.model,
        thinkingLevel: parent.thinkingLevel,
        isStreaming: false,
        currentLeafEntryId: null,
        queue: { steering: [], followUp: [] },
        queueDraft: [],
        subscriberCount: 0,
        leafCount: 1,
        branchSummary: null,
        stats: emptyStats(),
        runStartContextTokens: null,
        lastOpenedAt: null,
        lastCompletedAt: null,
        eventLog: eventLogRef as Session["eventLog"],
      }
      root.app.chats[chatId] = {
        id: chatId,
        scopeId,
        session: { kind: "ready", sessionId: childId },
        createdAt: Date.now(),
      }
      root.app.chatStates[chatId] = {
        chatId,
        locked: false,
        draft: editorText,
      }
      // Append a new tab containing this chat to the active pane
      // of the requested window's active workspace. Mirrors the
      // logic in `openChatInNewTabInRoot` but inlined so the whole
      // mutation is one transaction.
      const ws = root.app.windowStates[args.windowId]
      if (ws) {
        const workspaceId = parentScope.workspaceId
        // `activeView` carries the workspace id directly — setting
        // it here both selects the workspace and exits any
        // non-workspace view (e.g. onboarding) in one step.
        ws.activeView = { kind: "workspace", workspaceId }
        ws.selectedScopeId = scopeId
        const state = ws.workspacePanes?.[workspaceId]
        if (state && state.panes.length > 0) {
          const paneIdx =
            state.panes.findIndex(p => p.id === state.activePaneId) >= 0
              ? state.panes.findIndex(p => p.id === state.activePaneId)
              : 0
          const pane = state.panes[paneIdx]!
          // Seed a one-entry navigation history on the new tab so
          // the strip's back/forward arrows have a defined starting
          // point. Matches the helpers in window-state.ts.
          const newTabContent = { kind: "chat" as const, chatId }
          state.panes[paneIdx] = {
            ...pane,
            tabs: [
              ...pane.tabs,
              {
                id: tabId,
                content: newTabContent,
                history: {
                  entries: [{ ...newTabContent }],
                  index: 0,
                },
              },
            ],
            activeTabId: tabId,
          }
        }
      }
    })

    // Hydrate pi for the new session + rebuild its event log from
    // the file we just wrote. Same dance as clone(); see that
    // method for the rationale on why this is needed even though
    // the file already exists on disk.
    const childLive = await this.ensureLive(childId)
    await this.rebuildEventLogFromCurrentPath(childLive)

    // Marker event at the tail so materialize.ts can show a divider
    // "forked from <parent title>" — same pattern as cloned_from.
    childLive.seq++
    const forkEvent: EventItem = {
      seq: childLive.seq,
      kind: "forked_from",
      payload: {
        parentSessionId: parent.id,
        parentTitle: parent.title,
        parentEntryId: args.entryId,
      },
      timestamp: Date.now(),
    }
    await this.safeConcatEventLog(childId, [forkEvent], "fork marker")

    await this.syncRuntime(childLive)

    return { sessionId: childId, chatId, scopeId, editorText }
  }

  async deleteSession(args: { sessionId: string }) {
    const live = this.live.get(args.sessionId)
    if (live) {
      live.dispose()
      this.live.delete(args.sessionId)
    }
    await this.ctx.db.client.app.sessions[args.sessionId].eventLog
      .delete()
      .catch(() => {})
    await this.ctx.db.client.update(root => {
      delete root.app.sessions[args.sessionId]
    })
  }

  /**
   * Move a chat (and its underlying session, if any) into a freshly
   * created git worktree of the same repo.
   *
   *   1. Create the worktree on disk (`git worktree add -b <branch> <path>`)
   *      via `ReposService.createWorktree`, which also re-syncs the
   *      repo's worktree list into the DB.
   *   2. If the chat has a live `AgentSession` that's mid-turn, abort
   *      it and wait for the interrupt to land. Then dispose the live
   *      session entirely so the next prompt re-activates against the
   *      new cwd.
   *   3. In one DB transaction:
   *        - Materialize a new `scope` pointing at the new worktree
   *          directory (same workspace + repo).
   *        - Flip `chat.scopeId` and (when present) `session.scopeId`
   *          to the new scope.
   *        - Update the window's `selectedScopeId` cache when the
   *          moved chat is the active tab.
   *
   * The pi session JSONL on disk is untouched — it lives in
   * `PI_SESSION_DIR`, not the working directory — so the conversation
   * history is preserved. Only the cwd that pi's tools execute against
   * changes, and that happens lazily on the next `ensureLive()`.
   *
   * Errors:
   *   - chat unknown / no scope / scope has no `repoId` → throws.
   *   - `git worktree add` fails → throws with the git error.
   */
  async moveToNewWorktree(args: {
    chatId: string
    /** New branch name. Passed straight to `git worktree add -b`. */
    branch: string
    /** Absolute path for the new worktree. */
    worktreePath: string
    /** Active window id; used to keep `selectedScopeId` in sync when
     * this chat is currently the active tab. */
    windowId: string
    /**
     * Optional: if the *source* worktree has uncommitted changes,
     * commit them before creating the new worktree so the new
     * worktree branches off the post-commit HEAD (carrying the
     * work forward). When omitted the pending changes stay in the
     * source worktree as working-tree state and the new worktree
     * starts from the current HEAD without them. Empty `message`
     * → auto-generated marker.
     */
    commitFirst?: { message: string }
  }): Promise<{ scopeId: string; directory: string }> {
    const branch = args.branch.trim()
    const worktreePath = args.worktreePath.trim()
    if (!branch) throw new Error("branch name is required")
    if (!worktreePath) throw new Error("worktree path is required")

    const root0 = this.ctx.db.client.readRoot()
    const chat = root0.app.chats[args.chatId]
    if (!chat) throw new Error(`unknown chat ${args.chatId}`)
    const oldScope = root0.app.scopes[chat.scopeId]
    if (!oldScope) throw new Error(`unknown scope ${chat.scopeId}`)
    if (!oldScope.repoId) {
      throw new Error(
        "current scope is not a git repo (no repoId on scope)",
      )
    }

    // 0. Optional: commit uncommitted changes in the *current*
    //    worktree before branching, so the new worktree picks them
    //    up. This answers "do I want to take my pending changes
    //    with me?". When `commitFirst` is omitted the pending
    //    changes stay in the source worktree's working directory
    //    (the original behavior).
    if (args.commitFirst) {
      const message =
        args.commitFirst.message.trim() ||
        `auto-generated commit (worktree branch \`${branch}\`)`
      try {
        await execFileP("git", ["-C", oldScope.directory, "add", "-A"])
        await execFileP("git", [
          "-C",
          oldScope.directory,
          "commit",
          "-m",
          message,
        ])
      } catch (err) {
        // "nothing to commit" can happen if the renderer detected
        // dirty state that was tidied between then and now — not
        // really an error, just a no-op.
        const e = err as { stderr?: string; stdout?: string; message?: string }
        const detail = (e.stderr ?? e.stdout ?? e.message ?? "").toString()
        if (!/nothing to commit/i.test(detail)) {
          throw new Error(detail || "pre-worktree commit failed")
        }
      }
    }

    // 1. Create the worktree on disk. ReposService handles
    //    re-syncing the repo's worktree list into the DB.
    const createRes = await this.ctx.repos.createWorktree({
      repoId: oldScope.repoId,
      worktreePath,
      branch,
      // No sourceRef → git defaults to current HEAD of the probe
      // worktree, which is what users expect ("branch off where I am").
      createBranch: true,
    })
    if (!createRes.ok) {
      throw new Error(createRes.error ?? "git worktree add failed")
    }

    // 2. If the chat has a ready session, interrupt + dispose any
    //    live AgentSession so the next prompt re-activates with the
    //    new cwd. (Pi's tools capture cwd in closures at construction
    //    time — there's no in-place cwd swap.)
    const sessionId =
      chat.session.kind === "ready" ? chat.session.sessionId : null
    if (sessionId) {
      const live = this.live.get(sessionId)
      if (live) {
        if (live.pi.isStreaming) {
          // Await the interrupt before tearing down so we don't drop
          // tool output mid-stream and leave pi in a weird state.
          await live.pi.abort()
        }
        live.dispose()
        this.live.delete(sessionId)
      }
    }

    // 3. Single transactional flip: new scope + repoint chat + repoint
    //    session + window's selectedScopeId cache. Treats the move as
    //    a copy-and-rm (per design): old scope is left intact so any
    //    other chats living in it (or the sidebar's group heuristic)
    //    keep working. Sidebar already hides empty scope groups.
    const newScopeId = nanoid()
    const now = Date.now()
    await this.ctx.db.client.update(root => {
      // "Move chat to new worktree" creates a secondary scope by
      // construction — the user is forking off from an existing
      // one. Always start unpinned; the main worktree's pin is
      // already established on the original scope.
      root.app.scopes[newScopeId] = {
        id: newScopeId,
        workspaceId: oldScope.workspaceId,
        directory: worktreePath,
        repoId: oldScope.repoId,
        extraDirectories: [],
        createdAt: now,
        archived: false,
        completed: false,
        archivedAt: null,
        completedAt: null,
        pinnedAt: null,
        unpinnedAt: null,
      }
      const c = root.app.chats[args.chatId]
      if (c) c.scopeId = newScopeId
      if (sessionId) {
        const s = root.app.sessions[sessionId]
        if (s) s.scopeId = newScopeId
      }
      // Keep the active window's denormalized scope cache in sync if
      // this chat is the one currently visible. Other windows /
      // workspaces fix themselves up the next time the user clicks
      // around — selectedScopeId is a hint, not a source of truth.
      const ws = root.app.windowStates[args.windowId]
      if (ws && ws.activeView.kind === "workspace") {
        const state = ws.workspacePanes?.[ws.activeView.workspaceId]
        const activePane = state?.panes.find(p => p.id === state.activePaneId)
        const activeTab = activePane?.tabs.find(
          t => t.id === activePane.activeTabId,
        )
        if (
          activeTab &&
          activeTab.content.kind === "chat" &&
          activeTab.content.chatId === args.chatId
        ) {
          ws.selectedScopeId = newScopeId
        }
      }
    })

    return { scopeId: newScopeId, directory: worktreePath }
  }

  async subscribe(args: { sessionId: string; subscriberId: string }) {
    const live = await this.ensureLive(args.sessionId)
    live.subscribers.add(args.subscriberId)
    const count = live.subscribers.size
    await this.ctx.db.client.update(root => {
      const s = root.app.sessions[args.sessionId]
      if (!s) return
      s.subscriberCount = count
    })
  }

  async unsubscribe(args: { sessionId: string; subscriberId: string }) {
    const live = this.live.get(args.sessionId)
    if (!live) return
    live.subscribers.delete(args.subscriberId)
    const count = live.subscribers.size
    await this.ctx.db.client.update(root => {
      const s = root.app.sessions[args.sessionId]
      if (s) s.subscriberCount = count
    })
  }

  async prompt(args: {
    sessionId: string
    text: string
    /** Verbatim composer doc text — the same value the user sees in the
     * input. Used for chat-history rendering so the user-message bubble
     * can re-render via the read-only composer with pill widgets. When
     * omitted, falls back to `text` (legacy callers). */
    displayText?: string
    /** Image attachments forwarded directly to pi as `PromptOptions.images`. */
    images?: ImageContent[]
    /** Stable references for the same images (blobId + mimeType). Stored
     * on the user_prompt event so chat history can re-render the image
     * after a reload, without keeping base64 in the event log. */
    imageRefs?: { blobId: string; mimeType: string }[]
    /** Optional editor state for rehydrating pills on re-edit. */
    editorState?: unknown
    streamingBehavior?: "steer" | "followUp"
  }) {
    const live = await this.ensureLive(args.sessionId)
    // When streaming, route through the shadow so the QueuedMessages
    // panel sees this item. The renderer should normally call enqueue
    // directly, but supporting this path keeps callers that just say
    // "send" working uniformly.
    if (live.pi.isStreaming) {
      const kind: QueueKind = args.streamingBehavior ?? "followUp"
      await this.enqueue({
        sessionId: args.sessionId,
        text: args.text,
        displayText: args.displayText,
        kind,
        images: args.images,
        imageRefs: args.imageRefs,
        editorState: args.editorState,
      })
      return
    }
    await this.appendUserPromptEvent(
      live,
      args.displayText ?? args.text,
      args.imageRefs,
    )
    await this.stampLastMessageSent(args.sessionId)
    // Stake out the matching pi user message_end as "already in our
    // log" so onPiEvent doesn't synthesize a duplicate `user_prompt`.
    live.expectedUserMessages.push({ kind: "preStaged" })
    await live.pi.prompt(args.text, { images: args.images })
  }

  /**
   * Stamp `sessionMeta[sessionId].lastMessageSentTime = now`.
   *
   * Maintains a per-session timestamp the sidebar uses to sort by
   * "Recent activity" without ever reading the lazy `eventLog`
   * collection. Independent of the AI summary lifecycle — always
   * stamped, even if the summarizer is going to fail or skip.
   * Creates the row if it doesn't exist yet, with a null summary.
   */
  private async stampLastMessageSent(sessionId: string) {
    const now = Date.now()
    await this.ctx.db.client.update(root => {
      const existing = root.app.sessionMeta[sessionId]
      if (existing) {
        existing.lastMessageSentTime = now
      } else {
        root.app.sessionMeta[sessionId] = {
          sessionId,
          summary: null,
          lastMessageSentTime: now,
        }
      }
    })
  }

  async steer(args: { sessionId: string; text: string }) {
    const live = await this.ensureLive(args.sessionId)
    await live.pi.steer(args.text)
  }

  async followUp(args: { sessionId: string; text: string }) {
    const live = await this.ensureLive(args.sessionId)
    await live.pi.followUp(args.text)
  }

  /**
   * Abort the current turn. The pending queue (in both pi and the
   * shadow) is left intact — surviving items will drain into pi's
   * next turn. If the user wants to drop them, they can delete each
   * item from the panel, or use `sendQueuedNow` to redirect into a
   * specific queued message immediately.
   */
  async abort(args: { sessionId: string }) {
    const live = this.live.get(args.sessionId)
    if (!live) return
    await live.pi.abort()
    await this.syncRuntime(live)
  }

  /**
   * Append a rich message to the shadow and route into pi. Always
   * dispatched live — there's no held/paused state anymore.
   */
  async enqueue(args: {
    sessionId: string
    text: string
    /** See `prompt.displayText`. Defaults to `text`. */
    displayText?: string
    kind: QueueKind
    images?: ImageContent[]
    imageRefs?: ImageRef[]
    editorState?: unknown
  }) {
    const live = await this.ensureLive(args.sessionId)
    await this.withQueueLock(args.sessionId, async () => {
      const item: QueuedDraft = {
        id: nanoid(),
        // Persist the display form so the queued-messages UI renders
        // the same way the user typed it. Wire text (with metadata)
        // is rebuilt from the display text only when re-dispatching.
        text: args.displayText ?? args.text,
        images: args.imageRefs ?? [],
        editorState: args.editorState ?? null,
        createdAt: Date.now(),
        kind: args.kind,
      }
      await this.ctx.db.client.update(root => {
        const s = root.app.sessions[args.sessionId]
        if (!s) return
        s.queueDraft.push(item)
      })
      // Register the matching pi user message_end so onPiEvent
      // synthesizes a `user_prompt` event (with the right
      // displayText + imageRefs) when pi finally delivers this
      // item. Without this the chat surface never renders the
      // queued/steer message.
      live.expectedUserMessages.push({
        kind: "synthesize",
        displayText: item.text,
        imageRefs: item.images,
      })
      await this.dispatchToPi(live, args.kind, args.text, args.images)
    })
    // Enqueued items are user messages too — treat them as "last
    // message sent" for sort purposes, even if pi hasn't drained
    // them yet.
    await this.stampLastMessageSent(args.sessionId)
  }

  /**
   * Edit a queued shadow item. The implementation is the only one pi's
   * API permits: clearQueue + replay surviving items in order.
   */
  async editQueued(args: {
    sessionId: string
    id: string
    text: string
    images?: ImageContent[]
    imageRefs?: ImageRef[]
    editorState?: unknown
    kind?: QueueKind
  }) {
    const live = await this.ensureLive(args.sessionId)
    await this.withQueueLock(args.sessionId, async () => {
      await this.ctx.db.client.update(root => {
        const s = root.app.sessions[args.sessionId]
        if (!s) return
        const item = s.queueDraft.find(m => m.id === args.id)
        if (!item) return
        item.text = args.text
        if (args.imageRefs) item.images = args.imageRefs
        if ("editorState" in args) item.editorState = args.editorState ?? null
        if (args.kind) item.kind = args.kind
      })
      await this.replayShadowIntoPi(live, args.sessionId)
    })
  }

  async deleteQueued(args: { sessionId: string; id: string }) {
    const live = await this.ensureLive(args.sessionId)
    await this.withQueueLock(args.sessionId, async () => {
      await this.ctx.db.client.update(root => {
        const s = root.app.sessions[args.sessionId]
        if (!s) return
        s.queueDraft = s.queueDraft.filter(m => m.id !== args.id)
      })
      await this.replayShadowIntoPi(live, args.sessionId)
    })
  }

  /**
   * Send a specific queued item right now: interrupt whatever pi is
   * doing, fire the item as a fresh `prompt()`, and re-dispatch the
   * remaining queue items into pi so they fire after the new turn.
   *
   * This is the "jump the line" operation, used when the user wants
   * to redirect the agent into a particular queued message instead
   * of letting it drain in order.
   */
  async sendQueuedNow(args: { sessionId: string; id: string }) {
    const live = await this.ensureLive(args.sessionId)
    let dispatched = false
    await this.withQueueLock(args.sessionId, async () => {
      const s = this.ctx.db.client.readRoot().app.sessions[args.sessionId]
      const item = s?.queueDraft.find(m => m.id === args.id)
      if (!item) return

      // 1. Interrupt the current turn (no-op if pi is idle).
      await live.pi.abort()

      // 2. Drop the item from the shadow so the upcoming replay
      //    doesn't re-dispatch it as a queue entry.
      await this.ctx.db.client.update(root => {
        const ss = root.app.sessions[args.sessionId]
        if (!ss) return
        ss.queueDraft = ss.queueDraft.filter(m => m.id !== args.id)
      })

      // 3. Fire the item as a fresh prompt. Mirrors `prompt()`'s
      //    not-streaming branch: we own the user_prompt event and
      //    stake a `preStaged` expectation so onPiEvent doesn't
      //    synthesize a duplicate.
      await this.appendUserPromptEvent(live, item.text, item.images)
      live.expectedUserMessages.push({ kind: "preStaged" })
      await live.pi.prompt(item.text)

      // 4. Reconcile pi's queue with the now-smaller shadow. Pi may
      //    have been holding items behind the aborted turn; replay
      //    rebuilds its queue from scratch (`pi.clearQueue()` +
      //    per-item dispatch) so the remaining items will drain
      //    after the new prompt finishes. `dropSynthesizeExpectations`
      //    inside replay preserves the `preStaged` entry we just
      //    pushed.
      await this.replayShadowIntoPi(live, args.sessionId)
      dispatched = true
    })
    if (dispatched) await this.stampLastMessageSent(args.sessionId)
    await this.syncRuntime(live)
  }

  async setModel(args: { sessionId: string; provider: string; id: string }) {
    const live = await this.ensureLive(args.sessionId)
    const model = this.models.find(args.provider, args.id)
    if (!model) {
      throw new Error(`unknown model ${args.provider}/${args.id}`)
    }
    await live.pi.setModel(model)
    await this.syncRuntime(live)
  }

  async cycleModel(args: { sessionId: string }) {
    const live = await this.ensureLive(args.sessionId)
    const result = await live.pi.cycleModel()
    await this.syncRuntime(live)
    return result
  }

  async setThinkingLevel(args: {
    sessionId: string
    level: Session["thinkingLevel"]
  }) {
    const live = await this.ensureLive(args.sessionId)
    live.pi.setThinkingLevel(args.level)
    await this.syncRuntime(live)
  }

  async cycleThinkingLevel(args: { sessionId: string }) {
    const live = await this.ensureLive(args.sessionId)
    const next = live.pi.cycleThinkingLevel()
    await this.syncRuntime(live)
    return next
  }

  async compact(args: { sessionId: string; instructions?: string }) {
    const live = await this.ensureLive(args.sessionId)
    return live.pi.compact(args.instructions)
  }

  /**
   * Move the session leaf to a different entry in the tree. Wraps
   * pi's high-level `agentSession.navigateTree(targetId, options)`,
   * which gives us three escalating modes:
   *
   *   - default            — just rewind, no summary of the
   *                          abandoned branch.
   *   - `summarize: true`  — ask the model to summarize the
   *                          abandoned path and stamp a
   *                          `branch_summary` entry at the new
   *                          leaf so the agent re-enters the
   *                          branch with context.
   *   - `summarize: true` + `customInstructions` — same as above,
   *                          but the user provides extra steering
   *                          for the summarizer (see
   *                          `replaceInstructions` for full override).
   *
   * If the target entry is a user message, pi sets the leaf to its
   * parent and returns the original text in `editorText` so the
   * caller can re-seed the composer. We pass that back through the
   * RPC for the renderer to use.
   */
  async navigateTree(args: {
    sessionId: string
    entryId: string
    summarize?: boolean
    customInstructions?: string
    replaceInstructions?: boolean
  }): Promise<{
    cancelled: boolean
    aborted: boolean
    editorText: string | null
    summarized: boolean
  }> {
    const live = await this.ensureLive(args.sessionId)
    const result = await live.pi.navigateTree(args.entryId, {
      summarize: args.summarize,
      customInstructions: args.customInstructions,
      replaceInstructions: args.replaceInstructions,
    })
    await this.rebuildEventLogFromCurrentPath(live)
    await this.syncRuntime(live)
    return {
      cancelled: result.cancelled,
      aborted: result.aborted ?? false,
      editorText: result.editorText ?? null,
      summarized: !!result.summaryEntry,
    }
  }

  /**
   * Abort an in-flight branch summarization (the LLM call kicked
   * off by `navigateTree({ summarize: true })`). Safe to call when
   * no summary is running — pi handles the no-op internally.
   */
  async abortBranchSummary(args: { sessionId: string }) {
    const live = this.live.get(args.sessionId)
    if (!live) return
    live.pi.abortBranchSummary()
  }

  /**
   * Emit an `appendComposerDraft` event so a live Composer with the
   * matching `composerId` appends `text` to its current doc (rather
   * than replacing it). The renderer-side subscription is in the
   * Composer component; the chat-pane stamps `composerId={chat.id}`
   * so per-chat composers each receive only their own appends.
   *
   * Used by the user-message bubble's revert flow: after branching
   * to before a past user message, we drop that message's text into
   * the composer for the user to tweak before resending.
   */
  async appendComposerDraft(args: {
    composerId: string
    text: string
  }): Promise<void> {
    this.ctx.rpc.emit.app.appendComposerDraft({
      composerId: args.composerId,
      text: args.text,
    })
  }

  /**
   * Diagnostic-only RPC: returns the main-process's view of the
   * session's `runStartContextTokens`, current `eventLog` ref, and
   * the last `limit` event-log items. Used by the invariant overlay
   * to tell apart "data never reached the DB" (a real bug in the
   * main process) from "data is in the DB but the renderer's
   * subscription went stale" (a renderer-side caching bug, e.g. the
   * one that motivated rotating the eventLog ref on rebuild).
   *
   * The returned snapshot is whatever the main-process replica
   * currently sees — same source of truth as the renderer's
   * `useCollection`, but read here rather than over the
   * sync-to-renderer boundary, so a mismatch is meaningful.
   */
  async peekEventLogTail(args: {
    sessionId: string
    limit?: number
  }): Promise<{
    eventLogRef: { collectionId: string; debugName: string } | null
    seq: number | null
    recentKinds: Array<{ seq: number; kind: string; timestamp: number }>
    hasUserPromptWithText: string | null
    /** Live SessionManager's view of its own id + file. When these
     * don't match `session.piSessionId` / `session.sessionFile` on
     * the record, the runtime was mutated out from under us (the
     * classic `createBranchedSession` foot-gun — see clone()'s
     * comment). The invariant report uses this to fire a verdict
     * that points directly at the offending code. */
    runtimeMismatch: {
      recordSessionId: string
      recordSessionFile: string
      liveSessionId: string | null
      liveSessionFile: string | null
      mismatched: boolean
    } | null
    /** Last error from a concat against this session's eventLog,
     * if any. Populated by the wrapped concat helpers — lets the
     * invariant report distinguish "write actually failed" from
     * "renderer subscription dropped". */
    lastConcatError: { when: number; message: string } | null
    /** Authoritative view of the collection in the main process's
     * replica: total committed item count + last few items' seqs +
     * whether "hi"-style user_prompt entries matching the sent text
     * are actually in there. If this disagrees with what the
     * renderer's `useCollection` reports, the renderer's
     * subscription is genuinely stale (zenbu sync bug). If it
     * agrees but lacks the expected items, our writes never
     * reached the collection at all. */
    mainCollection: {
      totalCount: number
      recentSeqs: Array<{ seq: number; kind: string; timestamp: number }>
      hasUserPromptWithText: string | null
      probeError: string | null
    } | null
  }> {
    const root = this.ctx.db.client.readRoot()
    const session = root.app.sessions[args.sessionId]
    if (!session) {
      return {
        eventLogRef: null,
        seq: null,
        recentKinds: [],
        hasUserPromptWithText: null,
        runtimeMismatch: null,
        lastConcatError: null,
        mainCollection: null,
      }
    }
    const ref = session.eventLog as unknown as {
      collectionId: string
      debugName: string
    }
    const live = this.live.get(args.sessionId)
    let runtimeMismatch: {
      recordSessionId: string
      recordSessionFile: string
      liveSessionId: string | null
      liveSessionFile: string | null
      mismatched: boolean
    } | null = null
    if (live) {
      const liveSessionId =
        live.pi.sessionManager.getSessionId() ?? null
      const liveSessionFile =
        live.pi.sessionManager.getSessionFile() ?? null
      runtimeMismatch = {
        recordSessionId: session.piSessionId,
        recordSessionFile: session.sessionFile,
        liveSessionId,
        liveSessionFile,
        mismatched:
          (liveSessionId != null && liveSessionId !== session.piSessionId) ||
          (liveSessionFile != null && liveSessionFile !== session.sessionFile),
      }
    }
    // Probe the actual collection state in main's replica via
    // `subscribeData`. Resolves after the first emission carries the
    // current snapshot, then unsubscribes. With a short timeout so
    // we never block the renderer waiting on a hung subscription.
    const probeText = args.limit ? undefined : undefined
    void probeText
    let mainCollection: {
      totalCount: number
      recentSeqs: Array<{ seq: number; kind: string; timestamp: number }>
      hasUserPromptWithText: string | null
      probeError: string | null
    } | null = null
    try {
      mainCollection = await probeCollection(
        this.ctx.db.client.app.sessions[args.sessionId].eventLog,
        20,
      )
    } catch (err) {
      mainCollection = {
        totalCount: -1,
        recentSeqs: [],
        hasUserPromptWithText: null,
        probeError: err instanceof Error ? err.message : String(err),
      }
    }
    return {
      eventLogRef: ref
        ? { collectionId: ref.collectionId, debugName: ref.debugName }
        : null,
      seq: live?.seq ?? null,
      recentKinds: mainCollection?.recentSeqs ?? [],
      hasUserPromptWithText: mainCollection?.hasUserPromptWithText ?? null,
      runtimeMismatch,
      lastConcatError: live?.lastConcatError ?? null,
      mainCollection,
    }
  }

  /**
   * Rewind to just before the most recent user message on the current branch,
   * so the next prompt creates a sibling of that user message.
   * Returns { branched: false } if there's nothing to branch from.
   */
  async branchFromLastUserTurn(args: { sessionId: string }): Promise<{
    branched: boolean
    targetEntryId: string | null
  }> {
    const live = await this.ensureLive(args.sessionId)
    const entries = live.pi.sessionManager.getEntries()
    let lastUserEntry: { id: string; parentId: string | null } | null = null
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i] as any
      if (e?.type === "message" && e?.message?.role === "user") {
        lastUserEntry = { id: e.id, parentId: e.parentId ?? null }
        break
      }
    }
    if (!lastUserEntry || !lastUserEntry.parentId) {
      return { branched: false, targetEntryId: null }
    }
    live.pi.sessionManager.branch(lastUserEntry.parentId)
    await this.rebuildEventLogFromCurrentPath(live)
    await this.syncRuntime(live)
    return { branched: true, targetEntryId: lastUserEntry.parentId }
  }

  async getEntryTree(args: { sessionId: string }): Promise<{
    entries: Array<{
      id: string
      parentId: string | null
      kind: string
      label: string
      timestamp: number
      /** When `kind === "message"`, the underlying message role.
       * `null` for non-message entries (compaction, branch_summary,
       * etc.). The `/fork` picker uses this to gate which rows are
       * pickable — only `user` messages can be forked from. */
      messageRole: string | null
    }>
    leafId: string | null
  }> {
    const live = await this.ensureLive(args.sessionId)
    const raw = live.pi.sessionManager.getEntries()
    const leafId = live.pi.sessionManager.getLeafId() ?? null
    const entries = raw.map(e => ({
      id: e.id,
      parentId: e.parentId,
      kind: e.type,
      label: deriveEntryLabel(e),
      timestamp: parseTimestamp(e.timestamp),
      messageRole:
        e.type === "message"
          ? ((e as { message?: { role?: string } }).message?.role ?? null)
          : null,
    }))
    return { entries, leafId }
  }

  // ----- internals -----

  /**
   * Append a batch of items to a session's eventLog with failure
   * accounting. Every prior `.catch(() => {})` or
   * `.catch(err => console.error(...))` is routed through here so a
   * silent write failure no longer disappears: it gets stamped on
   * the LiveSession and surfaced by `peekEventLogTail` for the
   * invariant overlay.
   *
   * Why this matters: "missing_user_prompt_event" verdicts used to
   * blame the renderer subscription, but a silently rejected
   * concat looks identical from the renderer side. With this
   * helper, the next stale invariant either has a
   * `lastConcatError` (write actually failed in main) or doesn't
   * (the data IS in the collection — the renderer's subscription
   * is genuinely behind).
   */
  private async safeConcatEventLog(
    sessionId: string,
    items: EventItem[],
    context: string,
  ): Promise<void> {
    try {
      await this.ctx.db.client.app.sessions[sessionId].eventLog.concat(items)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[sessions] ${context} concat failed:`, err)
      const live = this.live.get(sessionId)
      if (live) {
        live.lastConcatError = { when: Date.now(), message }
      }
    }
  }

  private async ensureLive(sessionId: string): Promise<LiveSession> {
    const existing = this.live.get(sessionId)
    if (existing) return existing
    const inflight = this.activating.get(sessionId)
    if (inflight) return inflight
    const p = this.activate(sessionId).finally(() =>
      this.activating.delete(sessionId),
    )
    this.activating.set(sessionId, p)
    return p
  }

  private async activate(sessionId: string): Promise<LiveSession> {
    const record = this.requireRecord(sessionId)
    const scope = this.ctx.db.client.readRoot().app.scopes[record.scopeId]
    if (!scope) {
      throw new Error(`unknown scope ${record.scopeId} for session ${sessionId}`)
    }
    const sm = SessionManager.open(record.sessionFile, PI_SESSION_DIR)

    // Snapshot the Pi extension registry at activation time. Any
    // extensions registered by zenbu plugins (e.g. the plan plugin)
    // get loaded by Pi's normal extension discovery via
    // `DefaultResourceLoader.additionalExtensionPaths`. Existing
    // live sessions ignore later registry changes — see
    // `PiExtensionRegistryService` for the rationale.
    const additionalExtensionPaths = this.ctx.piExtensionRegistry
      .list()
      .map(e => e.path)
    const agentDir = getAgentDir()
    const scopeId = record.scopeId
    // The two override closures below intentionally re-read the scope
    // from the db on every call rather than capturing the snapshot
    // taken at activation time. That way, a later
    // `resourceLoader.reload()` (fired by the `scopes` subscription
    // we install below) picks up dirs the user (or another service)
    // appended to `extraDirectories` without us having to rebuild
    // the loader from scratch.
    const getExtraDirs = (): readonly string[] => {
      const s = this.ctx.db.client.readRoot().app.scopes[scopeId]
      return s?.extraDirectories ?? []
    }
    const resourceLoader = new DefaultResourceLoader({
      cwd: scope.directory,
      agentDir,
      additionalExtensionPaths,
      // Concatenate pi's primary-cwd AGENTS.md scan with one
      // `loadProjectContextFiles` call per extra dir. Pi feeds
      // the resulting array straight into the system prompt's
      // "<project_context>" block, so adding entries here is
      // semantically equivalent to having one giant AGENTS.md at
      // the cwd that imported all the others.
      agentsFilesOverride: base => {
        const extras = collectExtraAgentsFiles(
          getExtraDirs(),
          agentDir,
          base.agentsFiles,
        )
        return extras.length === 0
          ? base
          : { agentsFiles: [...base.agentsFiles, ...extras] }
      },
      // Append a markdown section that explicitly *names* the extra
      // dirs so the agent treats them as in-bounds for edits, not
      // just as readable context. Pi places each appendSystemPrompt
      // entry after the default system prompt; an empty list means
      // we contribute nothing.
      appendSystemPromptOverride: base => {
        const section = formatExtraDirsPrompt(getExtraDirs())
        return section ? [...base, section] : base
      },
    })
    await resourceLoader.reload()

    const options: CreateAgentSessionOptions = {
      cwd: scope.directory,
      sessionManager: sm,
      authStorage: this.auth,
      modelRegistry: this.models,
      resourceLoader,
    }
    if (record.model) {
      const model = this.models.find(record.model.provider, record.model.id)
      if (model) options.model = model
    }

    const { session } = await createAgentSession(options)

    const live = new LiveSession(sessionId, session, (l, e) =>
      this.onPiEvent(l, e),
    )
    live.extraDirsSnapshot = [...scope.extraDirectories]
    this.live.set(sessionId, live)

    // React to runtime changes in `extraDirectories` for this
    // scope. The DB replica fans changes out to every process
    // instantly, so a renderer-side mutation (or another service
    // calling `db.client.update`) lands here without an RPC round
    // trip. Diff against the cached snapshot to figure out what
    // changed; on any change reload the resource loader (so the
    // overrides above see the new list / load the new AGENTS.md)
    // and drop a quiet "aside" into pi so the agent gets a
    // mid-session notification.
    const unsubscribeScopes = this.ctx.db.client.app.scopes.subscribe(() => {
      void this.onScopesChanged(live, scopeId)
    })
    live.addDisposer(unsubscribeScopes)

    await this.syncRuntime(live)
    return live
  }

  /**
   * Compare the live session's cached `extraDirsSnapshot` with the
   * current `scope.extraDirectories`. If they differ, reload the
   * resource loader (so its overrides re-read the live list and
   * re-scan AGENTS.md files) and send a quiet aside to pi so the
   * agent learns about the change on its next turn without us
   * interrupting the current one.
   */
  private async onScopesChanged(
    live: LiveSession,
    scopeId: string,
  ): Promise<void> {
    const scope = this.ctx.db.client.readRoot().app.scopes[scopeId]
    if (!scope) return
    const before = live.extraDirsSnapshot
    const after = scope.extraDirectories
    const beforeSet = new Set(before)
    const afterSet = new Set(after)
    const added = after.filter(d => !beforeSet.has(d))
    const removed = before.filter(d => !afterSet.has(d))
    if (added.length === 0 && removed.length === 0) return
    live.extraDirsSnapshot = [...after]
    try {
      await live.pi.resourceLoader.reload()
    } catch (err) {
      console.warn(
        "[sessions] resourceLoader.reload() after extra-dirs change failed:",
        err,
      )
    }
    const lines: string[] = []
    if (added.length > 0) {
      lines.push(
        `The following working directories were added to this session and are now available to you:`,
      )
      for (const dir of added) lines.push(`- \`${dir}\``)
    }
    if (removed.length > 0) {
      if (lines.length > 0) lines.push("")
      lines.push(
        `The following working directories were removed and are no longer in scope:`,
      )
      for (const dir of removed) lines.push(`- \`${dir}\``)
    }
    if (added.length > 0) {
      lines.push("")
      lines.push(
        "Their AGENTS.md files (if any) have been merged into your context. You may read, edit, and run commands in these directories as needed.",
      )
    }
    const content = lines.join("\n")
    try {
      await live.pi.sendCustomMessage(
        {
          customType: "extraDirsChanged",
          content,
          // `display: false` keeps this aside out of the user-visible
          // chat surface. It's purely model-side context.
          display: false,
          details: { added, removed },
        },
        { deliverAs: "nextTurn" },
      )
    } catch (err) {
      console.warn(
        "[sessions] sendCustomMessage(extraDirsChanged) failed:",
        err,
      )
    }
  }

  private async onPiEvent(live: LiveSession, event: AgentSessionEvent) {
    live.seq++

    // Skip the synthetic user-side message events: we already
    // append a richer `user_prompt` item from `prompt()` (with
    // `imageRefs`), and the pi-emitted user `message_start` /
    // `message_end` would just double up in materialization.
    // Everything else — including every `message_update` delta
    // and the `partial: AssistantMessage` it carries — is
    // persisted verbatim so the event log is a faithful replay of
    // pi's subscription. Materialize.ts reconstructs the in-flight
    // assistant message directly from the latest `message_update`.
    const isUserMessageEvent =
      (event.type === "message_start" || event.type === "message_end") &&
      event.message.role === "user"

    if (!isUserMessageEvent) {
      const item: EventItem = {
        seq: live.seq,
        kind: event.type,
        payload: event,
        timestamp: Date.now(),
      }
      await this.safeConcatEventLog(live.sessionId, [item], "onPiEvent")
    } else if (event.type === "message_end") {
      // A pi user `message_end` is the moment a user message actually
      // lands in the conversation — whether it came from `prompt()`,
      // `enqueue()` (queued/steer), or pi delivering a queue item we
      // dispatched. We shift the FIFO of `expectedUserMessages` to
      // figure out which case we're in:
      //   - preStaged   — `prompt()` already appended a richer
      //                  `user_prompt` (with imageRefs, displayText).
      //                  Nothing to do; the materializer renders
      //                  that pre-staged event.
      //   - synthesize  — queued/steer delivery. Pi just "unqueued"
      //                  the message and is about to start the
      //                  assistant turn; append a `user_prompt`
      //                  event now so the chat surface renders the
      //                  user-message bubble before the assistant's.
      //   - <empty>     — unexpected (e.g. branch-restore replays
      //                  pi events outside our tracking). Fall back
      //                  to extracting text from the pi event so the
      //                  message at least shows up; imageRefs lost.
      const expected = live.expectedUserMessages.shift()
      if (!expected || expected.kind === "synthesize") {
        const displayText =
          expected?.kind === "synthesize"
            ? expected.displayText
            : extractTextContent(
                (event.message as { content?: unknown }).content,
              )
        const imageRefs =
          expected?.kind === "synthesize" ? expected.imageRefs : []
        const item: EventItem = {
          seq: live.seq,
          kind: "user_prompt",
          payload:
            imageRefs.length > 0
              ? { text: displayText, images: imageRefs }
              : { text: displayText },
          timestamp: Date.now(),
        }
        await this.safeConcatEventLog(
          live.sessionId,
          [item],
          "synthesize user_prompt",
        )
      }
    }

    // Snapshot the context-window baseline at the start of every
    // agent run. The renderer subtracts this from the live
    // `stats.contextUsage.tokens` to display the per-run "Xs, N
    // tokens" counter while streaming.
    //
    // We use pi's context-window measurement here (not the billing
    // rollup `stats.tokens.input/output/...`). The billing rollup
    // sums every LLM call's `usage.input` across the run, and each
    // call re-sends the entire growing context — so the rollup
    // balloons WAY past the actual conversation growth on
    // multi-turn (tool-call) runs. `contextUsage.tokens` is the
    // same value the context-view and status-bar already show, so
    // the two numbers tick at the same rate.
    //
    // Cleared on `agent_end` so the next prompt starts from a
    // fresh baseline.
    if (event.type === "agent_start") {
      await this.ctx.db.client.update(root => {
        const s = root.app.sessions[live.sessionId]
        if (!s) return
        s.runStartContextTokens = s.stats.contextUsage?.tokens ?? 0
      })
    } else if (event.type === "agent_end") {
      // Stamp `lastCompletedAt` so the unread-dot logic can detect
      // a turn finished. If the user is currently viewing the
      // session (tracked by `SessionActivityService`), also bump
      // `lastOpenedAt` so the dot never appears on a chat they're
      // already looking at. Anyone else (other windows, sidebar
      // rows) sees the dot until they focus the chat.
      const isViewed = this.ctx.sessionActivity.isViewed(live.sessionId)
      const now = Date.now()
      await this.ctx.db.client.update(root => {
        const s = root.app.sessions[live.sessionId]
        if (!s) return
        s.runStartContextTokens = null
        s.lastCompletedAt = now
        if (isViewed) s.lastOpenedAt = now
      })
    }

    if (
      event.type === "agent_start" ||
      event.type === "agent_end" ||
      event.type === "turn_end" ||
      event.type === "queue_update" ||
      event.type === "thinking_level_changed" ||
      event.type === "session_info_changed"
    ) {
      await this.syncRuntime(live)
    }

    if (event.type === "message_end" && event.message.role === "user") {
      void this.handleUserMessageForSummary(live, event.message.content)
    }
  }

  /**
   * On every new user message, generate a fresh summary with the cheap
   * model and overwrite `root.app.sessionMeta[sessionId].summary`.
   * The renderer subscribes to the db directly, so writes propagate
   * automatically.
   */
  private async handleUserMessageForSummary(
    live: LiveSession,
    content: string | (TextContent | ImageContent)[],
  ): Promise<void> {
    try {
      const text = await summarizeUserMessage(content)
      if (!text) return
      const piModel = live.pi.model
      const modelKey = piModel
        ? `${piModel.provider}/${piModel.id}`
        : "unknown"
      await this.ctx.summaries.record({
        sessionId: live.sessionId,
        text,
        model: modelKey,
      })
    } catch (err) {
      console.warn("[summary] handleUserMessageForSummary failed:", err)
    }
  }

  private async appendUserPromptEvent(
    live: LiveSession,
    text: string,
    imageRefs?: { blobId: string; mimeType: string }[],
  ) {
    live.seq++
    const item: EventItem = {
      seq: live.seq,
      kind: "user_prompt",
      payload: imageRefs && imageRefs.length > 0
        ? { text, images: imageRefs }
        : { text },
      timestamp: Date.now(),
    }
    await this.safeConcatEventLog(
      live.sessionId,
      [item],
      "appendUserPromptEvent",
    )
  }
  private async syncRuntime(live: LiveSession) {
    const pi = live.pi
    const modelRef: ProviderModelRef | null = pi.model
      ? { provider: pi.model.provider, id: pi.model.id }
      : null
    const thinkingLevel = pi.thinkingLevel as Session["thinkingLevel"]
    const isStreaming = pi.isStreaming
    const leafId = pi.sessionManager.getLeafId() ?? null
    const steering = [...pi.getSteeringMessages()]
    const followUp = [...pi.getFollowUpMessages()]
    const leafCount = countLeaves(pi.sessionManager.getEntries())
    const branchSummary = latestBranchSummary(pi.sessionManager.getBranch())
    const stats = computeStats(pi)
    await this.ctx.db.client.update(root => {
      const s = root.app.sessions[live.sessionId]
      if (!s) return
      s.model = modelRef
      s.thinkingLevel = thinkingLevel
      s.isStreaming = isStreaming
      s.currentLeafEntryId = leafId
      s.queue = { steering, followUp }
      s.leafCount = leafCount
      s.branchSummary = branchSummary
      s.stats = stats
      s.lastActivityAt = Date.now()
    })
    // Drop shadow items pi no longer holds (i.e. delivered) so the
    // panel updates as pi drains the queue. Only touches items in
    // `pending` state; `paused` items live entirely client-side.
    this.reconcileQueueDraft(live, steering, followUp)
  }

  /**
   * Pi's queue is the authority for delivery; our shadow is the
   * authority for payload. After every `queue_update` we walk our
   * shadow heads and drop any `pending` item whose text no longer
   * appears at the corresponding pi-queue head.
   *
   * Multiplicity is handled by consuming pi entries left-to-right as
   * we match shadow items in shadow order. A genuine drift (shadow
   * head text not present in pi at all) logs a warning and rebuilds
   * the shadow from pi's strings with synthetic ids.
   */
  private reconcileQueueDraft(
    live: LiveSession,
    piSteer: readonly string[],
    piFollow: readonly string[],
  ) {
    void this.ctx.db.client
      .update(root => {
        const s = root.app.sessions[live.sessionId]
        if (!s) return
        const steerPi = [...piSteer]
        const followPi = [...piFollow]
        const keep: typeof s.queueDraft = []
        let drift = false
        for (const item of s.queueDraft) {
          const pool = item.kind === "steer" ? steerPi : followPi
          const idx = pool.indexOf(item.text)
          if (idx >= 0) {
            pool.splice(idx, 1)
            keep.push(item)
          }
          // else: pi already delivered this item → drop from shadow.
        }
        // If pi still has strings we didn't account for, the shadow
        // drifted (e.g. a programmatic enqueue from elsewhere). Adopt
        // them so the panel stays consistent.
        if (steerPi.length > 0 || followPi.length > 0) {
          drift = true
          for (const text of steerPi) {
            keep.push({
              id: nanoid(),
              text,
              images: [],
              editorState: null,
              createdAt: Date.now(),
              kind: "steer",
            })
          }
          for (const text of followPi) {
            keep.push({
              id: nanoid(),
              text,
              images: [],
              editorState: null,
              createdAt: Date.now(),
              kind: "followUp",
            })
          }
        }
        if (drift) {
          console.warn(
            "[sessions] queueDraft drift; adopted pi state",
            live.sessionId,
          )
        }
        s.queueDraft = keep
      })
      .catch(err =>
        console.error("[sessions] reconcileQueueDraft failed:", err),
      )
  }

  /** Per-session async mutex protecting all queue mutations. Without
   * this, concurrent enqueue/edit/delete can race with each other and
   * with `clearQueue + replay`, leaving pi and the shadow out of
   * sync. */
  private readonly queueLocks = new Map<string, Promise<void>>()
  private async withQueueLock<T>(
    sessionId: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const prev = this.queueLocks.get(sessionId) ?? Promise.resolve()
    let release!: () => void
    const ticket = new Promise<void>(r => (release = r))
    this.queueLocks.set(sessionId, ticket)
    try {
      await prev
      return await fn()
    } finally {
      release()
      if (this.queueLocks.get(sessionId) === ticket) {
        this.queueLocks.delete(sessionId)
      }
    }
  }

  /** Send one item to pi based on kind. Used by enqueue and replay. */
  private async dispatchToPi(
    live: LiveSession,
    kind: QueueKind,
    text: string,
    images?: ImageContent[],
  ) {
    if (kind === "steer") {
      await live.pi.steer(text, images)
    } else {
      await live.pi.followUp(text, images)
    }
  }

  /**
   * Make pi's queue match the shadow's non-paused items, in shadow
   * order, by kind. The only knob pi gives us for this is
   * `clearQueue()` + per-item `steer`/`followUp` calls.
   *
   * Image *bytes* aren't replayed (we only persisted refs, not
   * base64). That's OK: pi's queue is delivered into a follow-up turn
   * where the bytes are recovered from the blob store at submit time.
   * If we ever need to replay with bytes, hydrate them from
   * `chatBlobs` here.
   */
  private async replayShadowIntoPi(live: LiveSession, sessionId: string) {
    live.pi.clearQueue()
    // Pi's queue is now empty — the synthesize expectations we had
    // for items in that queue are dead. Keep any preStaged entries
    // (their `pi.prompt` call is still in flight independent of
    // the queue) and re-register synthesize entries for each item
    // we're about to re-dispatch.
    this.dropSynthesizeExpectations(live)
    const s = this.ctx.db.client.readRoot().app.sessions[sessionId]
    if (!s) return
    for (const item of s.queueDraft) {
      live.expectedUserMessages.push({
        kind: "synthesize",
        displayText: item.text,
        imageRefs: item.images,
      })
      await this.dispatchToPi(live, item.kind, item.text)
    }
  }

  /** Drop every `synthesize` expectation, leaving `preStaged` ones
   * in place. Call this whenever we `pi.clearQueue()`: any queued
   * items pi was holding are now gone, so the matching pi
   * `message_end` events will never fire. */
  private dropSynthesizeExpectations(live: LiveSession) {
    live.expectedUserMessages = live.expectedUserMessages.filter(
      e => e.kind !== "synthesize",
    )
  }

  /**
   * Replace the chat's eventLog with synthesized events that reproduce
   * the materialized message stream for pi's current branch path.
   * Called after operations that move the leaf (navigateTree, branchFromLastUserTurn).
   */
  private async rebuildEventLogFromCurrentPath(live: LiveSession) {
    const messages = (live.pi as any).messages as any[] | undefined
    const events: EventItem[] = []
    let seq = 0
    if (Array.isArray(messages)) {
      for (const msg of messages) {
        const ts =
          typeof msg?.timestamp === "number" ? msg.timestamp : Date.now()
        if (msg?.role === "user") {
          events.push({
            seq: ++seq,
            kind: "user_prompt",
            payload: { text: extractTextContent(msg.content) },
            timestamp: ts,
          })
        } else if (msg?.role === "assistant") {
          events.push({
            seq: ++seq,
            kind: "message_end",
            payload: { message: msg },
            timestamp: ts,
          })
          const blocks = Array.isArray(msg.content) ? msg.content : []
          for (const block of blocks) {
            if (block?.type === "toolCall") {
              const callTs = ts
              events.push({
                seq: ++seq,
                kind: "tool_execution_start",
                payload: {
                  toolCallId: block.id,
                  toolName: block.name,
                  args: block.arguments,
                },
                timestamp: callTs,
              })
            }
          }
        } else if (msg?.role === "toolResult") {
          events.push({
            seq: ++seq,
            kind: "tool_execution_end",
            payload: {
              toolCallId: msg.toolCallId,
              toolName: msg.toolName,
              isError: !!msg.isError,
              result: msg.content,
            },
            timestamp: ts,
          })
        }
      }
    }
    // Rotate the eventLog collection ref instead of mutating the
    // existing one via `.delete() + .concat()`.
    //
    // Why: the renderer's `useCollection(eventLog)` subscribes to a
    // specific `collectionId`. If we wipe that collection's contents
    // and append new ones, the subscription's local view goes stale
    // — the chat-pane keeps showing the post-delete snapshot and
    // misses subsequent `.concat()` calls until the component
    // remounts (which is the "tab away + back" workaround). Pointing
    // `session.eventLog` at a brand new collectionId makes the ref
    // change propagate through `useDb`, which makes `useCollection`
    // resubscribe cleanly to the fresh collection.
    //
    // The previous collection is orphaned on disk. That's acceptable
    // for branch navigation: those events represent an abandoned
    // branch path the user explicitly walked away from.
    const newRef = {
      collectionId: nanoid(),
      debugName: `events-${live.sessionId}-${Date.now()}`,
    }
    await this.ctx.db.client.update(root => {
      const s = root.app.sessions[live.sessionId]
      if (s) s.eventLog = newRef as Session["eventLog"]
    })
    if (events.length > 0) {
      await this.safeConcatEventLog(
        live.sessionId,
        events,
        "rebuild eventLog",
      )
    }
    live.seq = seq
  }

  // ----- label derivation -----

  private requireRecord(sessionId: string): Session {
    const record = this.ctx.db.client.readRoot().app.sessions[sessionId]
    if (!record) {
      throw new Error(`unknown session ${sessionId}`)
    }
    return record
  }
}

/**
 * Force pi's SessionManager to write its current `fileEntries`
 * (typically just the session header at this point) to disk.
 *
 * Pi's public API has no "flush" method; `_rewriteFile` is
 * documented private but is the only call that does what we need.
 * Keep the cast confined to this helper so the rest of the
 * service stays type-safe.
 *
 * If pi later ships a public flush method, swap the body and this
 * comment goes away. The contract from callers' POV is simply:
 * "after this call returns, the session file exists on disk with
 * the correct session id in its header".
 */
function flushSessionManagerHeader(sm: SessionManager): void {
  try {
    ;(sm as unknown as { _rewriteFile(): void })._rewriteFile()
  } catch (err) {
    console.error("[sessions] flushSessionManagerHeader failed:", err)
  }
}

/**
 * Subscribe once to a collection, capture the initial state
 * snapshot, then unsubscribe. Used by the invariant diagnostic
 * probe in `peekEventLogTail` to get an authoritative view of what
 * actually lives in main's replica — distinct from the in-memory
 * `live.seq` counter (which only tracks attempted appends).
 *
 * Times out after 500ms (the probe runs in the renderer's hot path
 * when an invariant fires; we'd rather report a probe failure than
 * block the report).
 */
async function probeCollection(
  node: {
    subscribeData(
      cb: (data: {
        collection: { id: string; totalCount: number; items: unknown[] }
        newItems: unknown[]
      }) => void,
    ): () => void
  },
  tail: number,
): Promise<{
  totalCount: number
  recentSeqs: Array<{ seq: number; kind: string; timestamp: number }>
  hasUserPromptWithText: string | null
  probeError: string | null
}> {
  return new Promise(resolve => {
    let done = false
    let unsub: (() => void) | null = null
    const finish = (
      result: {
        totalCount: number
        recentSeqs: Array<{ seq: number; kind: string; timestamp: number }>
        hasUserPromptWithText: string | null
        probeError: string | null
      },
    ) => {
      if (done) return
      done = true
      if (unsub) unsub()
      resolve(result)
    }
    const timeout = setTimeout(() => {
      finish({
        totalCount: -1,
        recentSeqs: [],
        hasUserPromptWithText: null,
        probeError: "probe timeout (500ms)",
      })
    }, 500)
    try {
      unsub = node.subscribeData(data => {
        clearTimeout(timeout)
        const items = data.collection.items as Array<{
          seq?: number
          kind?: string
          timestamp?: number
          payload?: { text?: string }
        }>
        const recent = items.slice(-tail).map(it => ({
          seq: typeof it.seq === "number" ? it.seq : -1,
          kind: typeof it.kind === "string" ? it.kind : "?",
          timestamp:
            typeof it.timestamp === "number" ? it.timestamp : 0,
        }))
        finish({
          totalCount: data.collection.totalCount,
          recentSeqs: recent,
          hasUserPromptWithText: null,
          probeError: null,
        })
      })
    } catch (err) {
      clearTimeout(timeout)
      finish({
        totalCount: -1,
        recentSeqs: [],
        hasUserPromptWithText: null,
        probeError: err instanceof Error ? err.message : String(err),
      })
    }
  })
}

function emptyStats(): Session["stats"] {
  return {
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    cost: 0,
    contextUsage: null,
    autoCompactionEnabled: true,
  }
}

/**
 * Compute the same rollup pi's footer renders: cumulative assistant usage across
 * ALL session entries (including pre-compaction history), plus the live context
 * window estimate from `getContextUsage()`.
 */
function computeStats(pi: AgentSession): Session["stats"] {
  let input = 0
  let output = 0
  let cacheRead = 0
  let cacheWrite = 0
  let cost = 0
  for (const entry of pi.sessionManager.getEntries()) {
    if (entry.type === "message" && entry.message.role === "assistant") {
      const usage = entry.message.usage
      input += usage.input
      output += usage.output
      cacheRead += usage.cacheRead
      cacheWrite += usage.cacheWrite
      cost += usage.cost.total
    }
  }
  const ctx = pi.getContextUsage()
  return {
    tokens: { input, output, cacheRead, cacheWrite },
    cost,
    contextUsage: ctx
      ? {
          tokens: ctx.tokens,
          contextWindow: ctx.contextWindow,
          percent: ctx.percent,
        }
      : null,
    autoCompactionEnabled: pi.autoCompactionEnabled,
  }
}

function latestBranchSummary(
  branch: Array<{ type?: string; summary?: string }>,
): string | null {
  for (const entry of branch) {
    if (entry?.type === "branch_summary" && typeof entry.summary === "string") {
      const trimmed = entry.summary.trim()
      if (trimmed.length > 0) return trimmed
    }
  }
  return null
}

function countLeaves(entries: Array<{ id: string; parentId: string | null }>): number {
  if (entries.length === 0) return 1
  const hasChildren = new Set<string>()
  for (const e of entries) {
    if (e.parentId) hasChildren.add(e.parentId)
  }
  let leaves = 0
  for (const e of entries) {
    if (!hasChildren.has(e.id)) leaves++
  }
  return Math.max(1, leaves)
}

function parseTimestamp(ts: string | number | undefined): number {
  if (typeof ts === "number") return ts
  if (!ts) return 0
  const parsed = Date.parse(ts)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * Branch and compaction summaries carry an LLM-generated `summary`
 * string that's the actual content the user cares about. The sidebar
 * just renders this label, so we collapse whitespace and truncate
 * to one line. Fallback is used when the summary is missing or
 * empty (older entries without summaries).
 */
function summaryExcerpt(
  raw: unknown,
  fallback: string = "branched",
): string {
  if (typeof raw !== "string") return fallback
  const trimmed = raw.replace(/\s+/g, " ").trim()
  if (!trimmed) return fallback
  return truncate(trimmed, 80)
}

function deriveEntryLabel(entry: any): string {
  switch (entry.type) {
    case "message": {
      const msg = entry.message
      if (!msg) return "message"
      switch (msg.role) {
        case "user":
          return excerptFromContent(msg.content, "user")
        case "assistant":
          return excerptFromContent(msg.content, "assistant")
        case "toolResult":
          return `↳ ${msg.toolName ?? "tool"}`
        case "bashExecution":
          return `$ ${truncate(String(msg.command ?? ""), 60)}`
        case "custom":
          return `custom: ${msg.customType ?? ""}`
        case "branchSummary":
          return summaryExcerpt(msg.summary)
        case "compactionSummary":
          return summaryExcerpt(msg.summary, "compacted")
        default:
          return msg.role ?? "message"
      }
    }
    case "branch_summary":
      return summaryExcerpt(entry.summary)
    case "compaction":
      return summaryExcerpt(
        entry.summary,
        `compacted (${entry.tokensBefore ?? 0} tok)`,
      )
    case "model_change":
      return `model → ${entry.provider}/${entry.modelId}`
    case "thinking_level_change":
      return `thinking → ${entry.thinkingLevel}`
    case "session_info":
      return entry.name ? `renamed: ${entry.name}` : "session info"
    case "custom":
      return `custom: ${entry.customType ?? ""}`
    case "custom_message":
      return `custom msg: ${entry.customType ?? ""}`
    case "label":
      return entry.label ? `label: ${entry.label}` : "label"
    default:
      return entry.type ?? "entry"
  }
}

function excerptFromContent(
  content: unknown,
  role: "user" | "assistant",
): string {
  const text = extractText(content)
  const trimmed = text.trim()
  if (!trimmed) return role
  return truncate(trimmed.replace(/\s+/g, " "), 60)
}

function extractTextContent(content: unknown): string {
  return extractText(content)
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  const parts: string[] = []
  for (const block of content as Array<{ type?: string; text?: string }>) {
    if (block && block.type === "text" && typeof block.text === "string") {
      parts.push(block.text)
    }
  }
  return parts.join(" ")
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s
  return s.slice(0, n - 1) + "…"
}
