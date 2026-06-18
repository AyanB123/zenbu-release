import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { spawn } from "node:child_process"
import dotenv from "dotenv"

import { Service } from "@zenbujs/core/runtime"
import { DbService, RpcService } from "@zenbujs/core/services"
import type { ImageContent } from "@earendil-works/pi-ai"

import { AuthService } from "./auth"
import { SummariesService } from "./summaries"
import { PiExtensionRegistryService } from "./pi-extension-registry"
import { ReposService } from "./repos"
import { SessionActivityService } from "./session-activity"
import { ShellEnvService } from "./shell-env"

import { LiveSession, PROCESS_TOKEN } from "./sessions/live-session"
import type { ImageRef, QueueKind, Session } from "./sessions/types"
import {
  peekEventLogTail,
  rebuildEventLogFromCurrentPath,
} from "./sessions/event-log"
import { deriveEntryLabel, parseTimestamp } from "./sessions/labels"
import {
  acknowledgeKilledMarkers,
  acknowledgeReloadToasts,
  continueKilled,
  dismissKilled,
  reconcileKilledMarkersOnBoot,
  snapshotKilledMarkersOnDispose,
} from "./sessions/killed-markers"

const GH_AUTH_TIMEOUT_MS = 5000
const GH_GIST_TIMEOUT_MS = 30000
const MAX_LIVE_SESSIONS = 50
const LIVE_SESSION_IDLE_MS = 30 * 60 * 1000
const LIVE_SESSION_SWEEP_MS = 60 * 1000

dotenv.config({
  path: path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../.env",
  ),
  quiet: true,
})

let activationModulePromise:
  | Promise<typeof import("./sessions/activation")>
  | null = null
let branchingModulePromise:
  | Promise<typeof import("./sessions/branching")>
  | null = null
let scopeMovesModulePromise:
  | Promise<typeof import("./sessions/scope-moves")>
  | null = null
let queueModulePromise: Promise<typeof import("./sessions/queue")> | null = null

function loadActivationModule() {
  activationModulePromise ??= import("./sessions/activation")
  return activationModulePromise
}

function loadBranchingModule() {
  branchingModulePromise ??= import("./sessions/branching")
  return branchingModulePromise
}

function loadScopeMovesModule() {
  scopeMovesModulePromise ??= import("./sessions/scope-moves")
  return scopeMovesModulePromise
}

function loadQueueModule() {
  queueModulePromise ??= import("./sessions/queue")
  return queueModulePromise
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
    auth: AuthService,
    shellEnv: ShellEnvService,
  },
}) {
  /** In-memory live sessions, keyed by sessionId. Owned by this
   * service; modules under `./sessions/` read and mutate this
   * directly via the `svc` parameter they receive. */
  readonly live = new Map<string, LiveSession>()
  /** In-flight activations, deduped so concurrent callers get the
   * same promise instead of racing to create multiple pi runtimes
   * for the same session. */
  readonly activating = new Map<string, Promise<LiveSession>>()
  /** Per-session queue mutex tickets — see `withQueueLock` in
   * `./sessions/queue.ts`. */
  readonly queueLocks = new Map<string, Promise<void>>()
  private liveSessionSweepTimer: ReturnType<typeof setInterval> | null = null

  /**
   * Pi's credential store. Owned by `AuthService` — we just read
   * from it here so activation can pass it into `createAgentSession`.
   */
  get auth() {
    return this.ctx.auth.storage
  }
  /**
   * Pi's model registry. Owned by `AuthService`. Same story as
   * `auth` above — single source of truth.
   */
  get models() {
    return this.ctx.auth.registry
  }

  async evaluate() {
    await this.ctx.db.client.update(root => {
      for (const s of Object.values(root.app.sessions)) {
        s.isStreaming = false
        s.queue = { steering: [], followUp: [] }
        s.queueDraft = []
        s.subscriberCount = 0
      }
    })

    await this.ctx.shellEnv.getEnv()

    const refreshModelsTimer = setTimeout(() => {
      const runtimeState = globalThis as { __zenbu_shutting_down__?: boolean }
      if (runtimeState.__zenbu_shutting_down__) return
      void this.refreshAvailableModels().catch(err => {
        console.warn(
          "[sessions] background model refresh failed:",
          err instanceof Error ? err.message : err,
        )
      })
    }, 30_000)
    refreshModelsTimer.unref?.()
    await reconcileKilledMarkersOnBoot({ svc: this, processToken: PROCESS_TOKEN })

    this.liveSessionSweepTimer = setInterval(() => {
      void this.pruneLiveSessions("idle-sweep")
    }, LIVE_SESSION_SWEEP_MS)
    this.liveSessionSweepTimer.unref?.()

    this.setup("dispose-live", () => async () => {
      clearTimeout(refreshModelsTimer)
      if (this.liveSessionSweepTimer) {
        clearInterval(this.liveSessionSweepTimer)
        this.liveSessionSweepTimer = null
      }
      await snapshotKilledMarkersOnDispose({
        svc: this,
        processToken: PROCESS_TOKEN,
      })
      for (const sessionId of [...this.live.keys()]) {
        this.disposeLiveSession(sessionId, "service-dispose")
      }
    })
  }

  async refreshAvailableModels(): Promise<void> {
    await this.ctx.auth.publishStatuses()
  }
  

  // ----- session lifecycle (creation / branching / deletion) -----

  async createChatSession(args: {
    scopeId: string
    chatId: string
    parentSessionId?: string
    parentEntryId?: string
    title?: string
  }): Promise<{ sessionId: string }> {
    const { createChatSession } = await loadBranchingModule()
    return createChatSession({ svc: this, ...args })
  }

  async fork(args: {
    sessionId: string
    entryId: string
    workspaceId: string
    title?: string
  }): Promise<{ sessionId: string; chatId: string; scopeId: string }> {
    const { fork } = await loadBranchingModule()
    return fork({ svc: this, ...args })
  }

  async clone(args: {
    sessionId: string
    title?: string
  }): Promise<{ sessionId: string; chatId: string; scopeId: string }> {
    const { clone } = await loadBranchingModule()
    return clone({ svc: this, ...args })
  }

  async forkAtUserMessage(args: {
    sessionId: string
    entryId: string
    windowId: string
  }): Promise<{
    sessionId: string
    chatId: string
    scopeId: string
    editorText: string
  }> {
    const { forkAtUserMessage } = await loadBranchingModule()
    return forkAtUserMessage({ svc: this, ...args })
  }

  async deleteSession(args: { sessionId: string }): Promise<void> {
    const { deleteSession } = await loadBranchingModule()
    return deleteSession({ svc: this, ...args })
  }

  // ----- scope / worktree moves -----

  async moveToNewWorktree(args: {
    chatId: string
    branch: string
    worktreePath: string
    windowId: string
    commitFirst?: { message: string }
  }): Promise<{ scopeId: string; directory: string }> {
    const { moveToNewWorktree } = await loadScopeMovesModule()
    return moveToNewWorktree({ svc: this, ...args })
  }

  async moveChatToExistingScope(args: {
    chatId: string
    newScopeId: string
    windowId: string
    bumpCreatedAt: boolean
  }): Promise<{ ok: true } | { ok: false; error: string }> {
    const { moveChatToExistingScope } = await loadScopeMovesModule()
    return moveChatToExistingScope({ svc: this, ...args })
  }

  // ----- subscription bookkeeping -----

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

  // ----- sending / queue -----

  async prompt(args: {
    sessionId: string
    text: string
    displayText?: string
    images?: ImageContent[]
    imageRefs?: ImageRef[]
    editorState?: unknown
    streamingBehavior?: "steer" | "followUp"
  }): Promise<void> {
    const { prompt } = await loadQueueModule()
    return prompt({ svc: this, ...args })
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
    await this.syncLiveRuntime(live)
  }

  async enqueue(args: {
    sessionId: string
    text: string
    displayText?: string
    kind: QueueKind
    images?: ImageContent[]
    imageRefs?: ImageRef[]
    editorState?: unknown
  }): Promise<void> {
    const { enqueue } = await loadQueueModule()
    return enqueue({ svc: this, ...args })
  }

  async editQueued(args: {
    sessionId: string
    id: string
    text: string
    images?: ImageContent[]
    imageRefs?: ImageRef[]
    editorState?: unknown
    kind?: QueueKind
  }): Promise<void> {
    const { editQueued } = await loadQueueModule()
    return editQueued({ svc: this, ...args })
  }

  async deleteQueued(args: { sessionId: string; id: string }): Promise<void> {
    const { deleteQueued } = await loadQueueModule()
    return deleteQueued({ svc: this, ...args })
  }

  async sendQueuedNow(args: { sessionId: string; id: string }): Promise<void> {
    const { sendQueuedNow } = await loadQueueModule()
    return sendQueuedNow({ svc: this, ...args })
  }

  // ----- killed-session markers -----

  async continueKilled(args: { sessionIds: string[] }): Promise<void> {
    return continueKilled({ svc: this, ...args })
  }

  async dismissKilled(args: { sessionIds: string[] }): Promise<void> {
    return dismissKilled({ svc: this, ...args })
  }

  async acknowledgeKilledMarkers(args: {
    sessionIds: string[]
  }): Promise<void> {
    return acknowledgeKilledMarkers({ svc: this, ...args })
  }

  async acknowledgeReloadToasts(args: {
    sessionIds: string[]
  }): Promise<void> {
    return acknowledgeReloadToasts({ svc: this, ...args })
  }

  // ----- runtime knobs -----

  async setModel(args: { sessionId: string; provider: string; id: string }) {
    const live = await this.ensureLive(args.sessionId)
    const model = this.models.find(args.provider, args.id)
    if (!model) {
      throw new Error(`unknown model ${args.provider}/${args.id}`)
    }
    await live.pi.setModel(model)
    await this.syncLiveRuntime(live)
  }

  async cycleModel(args: { sessionId: string }) {
    const live = await this.ensureLive(args.sessionId)
    const result = await live.pi.cycleModel()
    await this.syncLiveRuntime(live)
    return result
  }

  async setThinkingLevel(args: {
    sessionId: string
    level: Session["thinkingLevel"]
  }) {
    const live = await this.ensureLive(args.sessionId)
    live.pi.setThinkingLevel(args.level)
    await this.syncLiveRuntime(live)
  }

  async cycleThinkingLevel(args: { sessionId: string }) {
    const live = await this.ensureLive(args.sessionId)
    const next = live.pi.cycleThinkingLevel()
    await this.syncLiveRuntime(live)
    return next
  }

  /**
   * Flip pi's auto-compaction setting for a live session. Auto-compaction
   * is the behavior where pi summarizes older turns as the context window
   * fills up; turning it off makes the session run headlong into the
   * limit instead. Surfaced from the status-bar pill in the footer so the
   * user can toggle without diving into a settings panel.
   */
  async setAutoCompactionEnabled(args: {
    sessionId: string
    enabled: boolean
  }) {
    const live = await this.ensureLive(args.sessionId)
    live.pi.setAutoCompactionEnabled(args.enabled)
    await this.syncLiveRuntime(live)
  }

  async compact(args: { sessionId: string; instructions?: string }) {
    const live = await this.ensureLive(args.sessionId)
    return live.pi.compact(args.instructions)
  }

  async reload(args: { sessionId: string }): Promise<{ ok: true }> {
    const live = await this.ensureLive(args.sessionId)
    await live.pi.reload()
    await this.syncLiveRuntime(live)
    return { ok: true }
  }

  async exportSession(args: {
    sessionId: string
    outputPath?: string
  }): Promise<{ path: string; format: "html" | "jsonl" }> {
    const live = await this.ensureLive(args.sessionId)
    const outputPath = args.outputPath?.trim() || undefined
    if (outputPath?.endsWith(".jsonl")) {
      return {
        path: live.pi.exportToJsonl(outputPath),
        format: "jsonl",
      }
    }
    return {
      path: await live.pi.exportToHtml(outputPath),
      format: "html",
    }
  }

  async shareSession(args: { sessionId: string }): Promise<{
    gistUrl: string
    viewerUrl: string
  }> {
    const auth = await spawnBufferedWithTimeout(
      "gh",
      ["auth", "status"],
      GH_AUTH_TIMEOUT_MS,
    )
    if (auth.status !== 0) {
      throw new Error(
        auth.stderr.trim() ||
          "GitHub CLI is not logged in. Run `gh auth login` first.",
      )
    }

    const live = await this.ensureLive(args.sessionId)
    const tmpFile = path.join(os.tmpdir(), `pi-session-${args.sessionId}.html`)
    await live.pi.exportToHtml(tmpFile)

    const result = await spawnBufferedWithTimeout(
      "gh",
      ["gist", "create", "--public=false", tmpFile],
      GH_GIST_TIMEOUT_MS,
    )
    if (result.code !== 0) {
      throw new Error(result.stderr.trim() || "Failed to create gist")
    }
    const gistUrl = result.stdout.trim()
    const gistId = gistUrl.split("/").pop()
    if (!gistId) throw new Error("Failed to parse gist id from gh output")
    const base = process.env.PI_SHARE_VIEWER_URL || "https://pi.dev/session/"
    return { gistUrl, viewerUrl: `${base}#${gistId}` }
  }

  async getLastAssistantText(args: { sessionId: string }): Promise<{
    text: string | null
  }> {
    const live = await this.ensureLive(args.sessionId)
    return { text: live.pi.getLastAssistantText() ?? null }
  }

  async setSessionName(args: {
    sessionId: string
    name: string
  }): Promise<{ ok: true }> {
    const live = await this.ensureLive(args.sessionId)
    live.pi.setSessionName(args.name)
    await this.syncLiveRuntime(live)
    return { ok: true }
  }

  async getSessionInfo(args: { sessionId: string }) {
    const live = await this.ensureLive(args.sessionId)
    return {
      name: live.pi.sessionName ?? null,
      file: live.pi.sessionFile ?? null,
      id: live.pi.sessionId,
      stats: live.pi.getSessionStats(),
    }
  }

  // ----- tree navigation -----

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
    const ctx = {
      db: this.ctx.db.client,
      getLive: (id: string) => this.live.get(id),
    }
    await rebuildEventLogFromCurrentPath({ ctx, live })
    await this.syncLiveRuntime(live)
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
    const ctx = {
      db: this.ctx.db.client,
      getLive: (id: string) => this.live.get(id),
    }
    await rebuildEventLogFromCurrentPath({ ctx, live })
    await this.syncLiveRuntime(live)
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
      label: deriveEntryLabel({ entry: e }),
      timestamp: parseTimestamp({ ts: e.timestamp }),
      messageRole:
        e.type === "message"
          ? ((e as { message?: { role?: string } }).message?.role ?? null)
          : null,
    }))
    return { entries, leafId }
  }

  // ----- composer events -----

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

  // ----- diagnostics -----

  /**
   * Diagnostic-only RPC: returns the main-process's view of the
   * session's `runStartContextTokens`, current `eventLog` ref, and
   * the last `limit` event-log items. Used by the invariant overlay
   * to tell apart "data never reached the DB" (a real bug in the
   * main process) from "data is in the DB but the renderer's
   * subscription went stale" (a renderer-side caching bug, e.g. the
   * one that motivated rotating the eventLog ref on rebuild).
   */
  async peekEventLogTail(args: {
    sessionId: string
    limit?: number
  }) {
    return peekEventLogTail({
      ctx: {
        db: this.ctx.db.client,
        getLive: (id: string) => this.live.get(id),
      },
      ...args,
    })
  }

  // ----- internals shared with helper modules -----

  /**
   * Get-or-create a live `LiveSession` for the given session id.
   * Public because helper modules under `./sessions/` reach in
   * through `svc.ensureLive(...)` rather than re-implementing the
   * dedup-on-concurrent-callers logic.
   */
  async ensureLive(sessionId: string): Promise<LiveSession> {
    const existing = this.live.get(sessionId)
    if (existing) return existing
    const inflight = this.activating.get(sessionId)
    if (inflight) return inflight
    await this.pruneLiveSessions("before-activate")
    await this.ctx.auth.ready()
    const p = loadActivationModule()
      .then(({ activate }) => activate({ svc: this, sessionId }))
      .finally(() => this.activating.delete(sessionId))
    this.activating.set(sessionId, p)
    return p
  }

  /** Re-exported so helper modules can call it without importing
   * the activation module separately. */
  resolveSessionLabelSnapshot(sessionId: string): string {
    return resolveSessionLabelSnapshotLocal({ svc: this, sessionId })
  }

  private async syncLiveRuntime(live: LiveSession): Promise<void> {
    const { syncRuntime } = await loadActivationModule()
    await syncRuntime({ svc: this, live })
  }

  disposeLiveSession(sessionId: string, reason: string): boolean {
    const live = this.live.get(sessionId)
    if (!live) return false
    this.live.delete(sessionId)
    this.activating.delete(sessionId)
    this.queueLocks.delete(sessionId)
    try {
      live.dispose()
    } catch (err) {
      console.warn(
        `[sessions] disposeLiveSession failed (${reason}) for ${sessionId}:`,
        err instanceof Error ? err.message : err,
      )
    }
    return true
  }

  private async pruneLiveSessions(reason: string): Promise<void> {
    if (this.live.size === 0) return
    const now = Date.now()
    const sessions = this.ctx.db.client.readRoot().app.sessions
    const candidates = [...this.live.entries()]
      .filter(([, live]) => isDisposableLiveSession(live))
      .map(([sessionId, live]) => ({
        sessionId,
        lastActivityAt: sessions[sessionId]?.lastActivityAt ?? 0,
        live,
      }))
      .sort((a, b) => a.lastActivityAt - b.lastActivityAt)

    for (const candidate of candidates) {
      if (now - candidate.lastActivityAt < LIVE_SESSION_IDLE_MS) continue
      this.disposeLiveSession(candidate.sessionId, reason)
    }

    if (this.live.size <= MAX_LIVE_SESSIONS) return
    for (const candidate of candidates) {
      if (this.live.size <= MAX_LIVE_SESSIONS) return
      this.disposeLiveSession(candidate.sessionId, "capacity")
    }
  }
}

function resolveSessionLabelSnapshotLocal(args: {
  svc: SessionsService
  sessionId: string
}): string {
  const { svc, sessionId } = args
  const root = svc.ctx.db.client.readRoot()
  const summary = root.app.sessionMeta[sessionId]?.summary?.text?.trim()
  if (summary) return summary
  const session = root.app.sessions[sessionId]
  if (!session) return ""
  const branchSummary = session.branchSummary?.trim()
  if (branchSummary) return branchSummary
  const title = session.title?.trim()
  if (title && title !== "Untitled") return title
  return ""
}

function isDisposableLiveSession(live: LiveSession): boolean {
  return (
    live.subscribers.size === 0 &&
    !live.inAgentLoop &&
    !live.pi.isStreaming
  )
}

function spawnBufferedWithTimeout(
  cmd: string,
  args: string[],
  timeoutMs: number,
): Promise<{
  stdout: string
  stderr: string
  code: number | null
  status: number | null
}> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      proc.kill()
      reject(new Error(`${cmd} timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    timer.unref?.()
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
    }
    proc.stdout?.on("data", chunk => {
      stdout += String(chunk)
    })
    proc.stderr?.on("data", chunk => {
      stderr += String(chunk)
    })
    proc.on("error", err => finish(() => reject(err)))
    proc.on("close", code =>
      finish(() => resolve({ stdout, stderr, code, status: code })),
    )
  })
}
