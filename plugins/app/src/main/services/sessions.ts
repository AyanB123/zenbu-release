import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { spawn, spawnSync } from "node:child_process"
import dotenv from "dotenv"

import { Service } from "@zenbujs/core/runtime"
import { DbService, RpcService } from "@zenbujs/core/services"
import type { ImageContent } from "@earendil-works/pi-ai"

import { AuthService } from "./auth"
import { SummariesService } from "./summaries"
import { PiExtensionRegistryService } from "./pi-extension-registry"
import { ReposService } from "./repos"
import { SessionActivityService } from "./session-activity"

import { LiveSession, PROCESS_TOKEN } from "./sessions/live-session"
import type { ImageRef, QueueKind, Session } from "./sessions/types"
import {
  activate,
  resolveSessionLabelSnapshot,
  syncRuntime,
} from "./sessions/activation"
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
import {
  clone,
  createChatSession,
  deleteSession,
  fork,
  forkAtUserMessage,
} from "./sessions/branching"
import {
  moveChatToExistingScope,
  moveToNewWorktree,
} from "./sessions/scope-moves"
import {
  deleteQueued,
  editQueued,
  enqueue,
  prompt,
  sendQueuedNow,
} from "./sessions/queue"

dotenv.config({
  path: path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../.env",
  ),
  quiet: true,
})

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
    // Boot reset: pi processes from a previous run are gone, so
    // every session's transient fields (streaming flag, pi-side
    // queue mirror, shadow queue, subscriber count) need to start
    // empty. The shadow queue is dropped because we have no
    // pause/resume mechanism to hold items client-side once pi
    // restarts — the user can re-queue if they still want them.
    await this.ctx.db.client.update(root => {
      for (const s of Object.values(root.app.sessions)) {
        s.isStreaming = false
        s.queue = { steering: [], followUp: [] }
        s.queueDraft = []
        s.subscriberCount = 0
      }
    })

    await this.refreshAvailableModels()
    await reconcileKilledMarkersOnBoot({ svc: this, processToken: PROCESS_TOKEN })

    this.setup("dispose-live", () => async () => {
      await snapshotKilledMarkersOnDispose({
        svc: this,
        processToken: PROCESS_TOKEN,
      })
    })
  }

  /**
   * Republish the available-model catalog AND provider auth
   * statuses. Both writes happen inside a single `update()` so the
   * renderer never sees a partial state where the model picker
   * has lit up but the accounts panel still shows "Not connected"
   * (or vice versa).
   *
   * Kept as a passthrough so existing callers (boot, future
   * activation hooks) don't have to know that the heavy lifting
   * moved into `AuthService`.
   */
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
    return createChatSession({ svc: this, ...args })
  }

  async fork(args: {
    sessionId: string
    entryId: string
    workspaceId: string
    title?: string
  }): Promise<{ sessionId: string; chatId: string; scopeId: string }> {
    return fork({ svc: this, ...args })
  }

  async clone(args: {
    sessionId: string
    title?: string
  }): Promise<{ sessionId: string; chatId: string; scopeId: string }> {
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
    return forkAtUserMessage({ svc: this, ...args })
  }

  async deleteSession(args: { sessionId: string }): Promise<void> {
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
    return moveToNewWorktree({ svc: this, ...args })
  }

  async moveChatToExistingScope(args: {
    chatId: string
    newScopeId: string
    windowId: string
    bumpCreatedAt: boolean
  }): Promise<{ ok: true } | { ok: false; error: string }> {
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
    await syncRuntime({ svc: this, live })
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
    return editQueued({ svc: this, ...args })
  }

  async deleteQueued(args: { sessionId: string; id: string }): Promise<void> {
    return deleteQueued({ svc: this, ...args })
  }

  async sendQueuedNow(args: { sessionId: string; id: string }): Promise<void> {
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
    await syncRuntime({ svc: this, live })
  }

  async cycleModel(args: { sessionId: string }) {
    const live = await this.ensureLive(args.sessionId)
    const result = await live.pi.cycleModel()
    await syncRuntime({ svc: this, live })
    return result
  }

  async setThinkingLevel(args: {
    sessionId: string
    level: Session["thinkingLevel"]
  }) {
    const live = await this.ensureLive(args.sessionId)
    live.pi.setThinkingLevel(args.level)
    await syncRuntime({ svc: this, live })
  }

  async cycleThinkingLevel(args: { sessionId: string }) {
    const live = await this.ensureLive(args.sessionId)
    const next = live.pi.cycleThinkingLevel()
    await syncRuntime({ svc: this, live })
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
    await syncRuntime({ svc: this, live })
  }

  async compact(args: { sessionId: string; instructions?: string }) {
    const live = await this.ensureLive(args.sessionId)
    return live.pi.compact(args.instructions)
  }

  async reload(args: { sessionId: string }): Promise<{ ok: true }> {
    const live = await this.ensureLive(args.sessionId)
    await live.pi.reload()
    await syncRuntime({ svc: this, live })
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
    const auth = spawnSync("gh", ["auth", "status"], { encoding: "utf8" })
    if (auth.status !== 0) {
      throw new Error("GitHub CLI is not logged in. Run `gh auth login` first.")
    }

    const live = await this.ensureLive(args.sessionId)
    const tmpFile = path.join(os.tmpdir(), `pi-session-${args.sessionId}.html`)
    await live.pi.exportToHtml(tmpFile)

    const result = await new Promise<{
      stdout: string
      stderr: string
      code: number | null
    }>((resolve, reject) => {
      const proc = spawn("gh", ["gist", "create", "--public=false", tmpFile])
      let stdout = ""
      let stderr = ""
      proc.stdout?.on("data", chunk => {
        stdout += String(chunk)
      })
      proc.stderr?.on("data", chunk => {
        stderr += String(chunk)
      })
      proc.on("error", reject)
      proc.on("close", code => resolve({ stdout, stderr, code }))
    })
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
    await syncRuntime({ svc: this, live })
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
    await syncRuntime({ svc: this, live })
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
    await syncRuntime({ svc: this, live })
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
    const p = activate({ svc: this, sessionId }).finally(() =>
      this.activating.delete(sessionId),
    )
    this.activating.set(sessionId, p)
    return p
  }

  /** Re-exported so helper modules can call it without importing
   * the activation module separately. */
  resolveSessionLabelSnapshot(sessionId: string): string {
    return resolveSessionLabelSnapshot({ svc: this, sessionId })
  }
}
