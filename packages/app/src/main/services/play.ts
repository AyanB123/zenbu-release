import { spawn, type ChildProcess } from "node:child_process"
import os from "node:os"
import { Service } from "@zenbujs/core/runtime"
import { DbService, RpcService } from "@zenbujs/core/services"
import { nanoid } from "nanoid"
import { shellEnv } from "shell-env"
import type { Schema } from "../schema"

type PlayConfig = Schema["playConfigs"][string]

type LiveRun = {
  workspaceId: string
  runId: string
  /** The scope this run is bound to. Setup completion is tracked
   * per-scope (each scope is an independent worktree/directory),
   * so we need to know which scope to mark as set-up when the
   * setup phase exits cleanly. */
  scopeId: string
  child: ChildProcess
  /** Whether we're in the "setup is still running, start hasn't
   * been spawned yet" phase. Used to know whether a clean exit
   * should advance to the start phase or mark the run done. */
  phase: "setup" | "start"
  /** The user-typed start command, captured at run time so a
   * concurrent `saveConfig()` editing the workspace can't change
   * what we run between setup and start. */
  startCommand: string
  cwd: string
  /** Coalesced log buffer + flush timer. We collapse a burst of
   * `data` events into a single `concat()` so the DB doesn't
   * see thousands of one-line writes. */
  pendingLogs: Array<{
    ts: number
    stream: "stdout" | "stderr" | "system"
    data: string
    runId: string
  }>
  flushTimer: ReturnType<typeof setTimeout> | null
  /** SIGKILL escalation timer. Set the moment we send SIGINT in
   * `stop()`; cleared when the child actually exits. */
  killTimer: ReturnType<typeof setTimeout> | null
  /** True after we've sent SIGINT and are waiting on the
   * escalation timer. A second `stop()` while this is true
   * skips the grace period and goes straight to SIGKILL. */
  killing: boolean
}

/** How often we flush log batches into the collection. Tuned to feel
 * live (60fps-ish) without making the DB layer do 60 writes/sec per
 * running play session. */
const LOG_FLUSH_MS = 50

/** How long we give a child between SIGINT (graceful, the same
 * signal you'd send by hitting Ctrl+C in a terminal) and SIGKILL
 * (force). Dev servers like Vite / Next typically tear down in
 * well under a second; this is forgiving without being annoying. */
const SIGKILL_GRACE_MS = 3000

/**
 * Owns one child process per workspace, kicked off by the play
 * button in the title bar. Each workspace's `playConfig` record in
 * the DB holds the user's setup/start commands, whether setup has
 * already been done, and an `isRunning` mirror of the in-memory
 * process map. The `logs` collection on the same record is the
 * append-only stream the play popover renders (stdout, stderr,
 * and synthetic "system" banners like "$ npm run dev" / "exit 0").
 *
 * On boot we reset every `isRunning` / `currentRunId` to false/null
 * because the in-memory `live` map starts empty \u2014 the user can have
 * quit mid-run last session and we don't want a stale "Stop" button.
 * TODO(zenbu.js): once core grows the "service-only, not synced
 * to disk" database state we keep talking about, that reset goes
 * away (and `isRunning` lives in the ephemeral half of state).
 */
export class PlayService extends Service.create({
  key: "play",
  deps: { db: DbService, rpc: RpcService },
}) {
  private readonly live = new Map<string, LiveRun>()
  /** Cached shell env. Resolved lazily on first run because
   * `shellEnv()` shells out and we don't want to pay for it on
   * apps that never use the play button. */
  private cachedShellEnv: NodeJS.ProcessEnv | null = null

  async evaluate() {
    await this.resetStaleRunFlags()

    this.setup("dispose-all", () => async () => {
      const entries = [...this.live.values()]
      this.live.clear()
      await Promise.all(entries.map(entry => this.killEntry(entry)))
    })
  }

  /**
   * Resets every workspace's `isRunning` / `currentRunId` /
   * `currentRunStartedAt` to the "idle" sentinel. Called once on
   * service boot to recover from the case where the app quit
   * before `playExit` could land.
   */
  private async resetStaleRunFlags(): Promise<void> {
    const root = this.ctx.db.client.readRoot()
    const dirty: string[] = []
    for (const [id, cfg] of Object.entries(root.app.playConfigs)) {
      if (cfg.isRunning || cfg.currentRunId || cfg.currentRunStartedAt) {
        dirty.push(id)
      }
    }
    if (dirty.length === 0) return
    await this.ctx.db.client.update(root => {
      for (const id of dirty) {
        const cfg = root.app.playConfigs[id]
        if (!cfg) continue
        cfg.isRunning = false
        cfg.currentRunId = null
        cfg.currentRunStartedAt = null
      }
    })
  }

  /**
   * Persist the user's setup / start commands for `workspaceId`,
   * creating the record (and its `logs` collection ref) on the
   * first call. Editing `setupCommand` clears the per-scope
   * "setup ran successfully" list so every scope re-runs setup
   * against the new command.
   */
  async saveConfig(args: {
    workspaceId: string
    setupCommand: string | null
    startCommand: string
  }): Promise<void> {
    const setup = normalize(args.setupCommand)
    const start = (args.startCommand ?? "").trim()
    if (!start) throw new Error("startCommand is required")
    await this.ctx.db.client.update(root => {
      const existing = root.app.playConfigs[args.workspaceId]
      if (existing) {
        const setupChanged = existing.setupCommand !== setup
        existing.setupCommand = setup
        existing.startCommand = start
        if (setupChanged) existing.setupCompletedScopeIds = []
      } else {
        const logsRef = {
          collectionId: nanoid(),
          debugName: `play-logs-${args.workspaceId}`,
        }
        root.app.playConfigs[args.workspaceId] = {
          workspaceId: args.workspaceId,
          setupCommand: setup,
          startCommand: start,
          setupCompletedScopeIds: [],
          isRunning: false,
          currentRunId: null,
          currentRunStartedAt: null,
          logs: logsRef as PlayConfig["logs"],
        }
      }
    })
  }

  /**
   * Start a play run for `workspaceId` against `scopeId` (whose
   * working directory is `cwd`). Runs the setup command first if
   * it's configured and this scope is not in the workspace's
   * `setupCompletedScopeIds` list; otherwise skips straight to
   * the start command. The whole thing is a no-op if the
   * workspace is already running.
   *
   * Setup state is per-scope rather than per-workspace because
   * each scope is its own worktree / directory and has to be
   * independently bootstrapped (e.g. `pnpm install` writes
   * `node_modules/` into the scope's directory). So clicking Run
   * on a fresh scope correctly re-runs setup even if some other
   * scope in the workspace was already set up.
   *
   * Returns the new `runId` (or the existing one when the workspace
   * was already running). Throws if the workspace has no config or
   * no start command yet.
   */
  async run(args: {
    workspaceId: string
    scopeId: string
    cwd: string
  }): Promise<{ runId: string }> {
    const root = this.ctx.db.client.readRoot()
    const cfg = root.app.playConfigs[args.workspaceId]
    if (!cfg) {
      throw new Error("play config has not been set up yet")
    }
    if (!cfg.startCommand) {
      throw new Error("startCommand is empty")
    }
    if (cfg.isRunning) {
      const existing = this.live.get(args.workspaceId)
      if (existing) return { runId: existing.runId }
      // DB says running but we have no in-memory entry — the
      // service must have just restarted and `resetStaleRunFlags`
      // is racing us. Fall through and start fresh.
    }

    const runId = nanoid()
    const env = await this.resolveEnv()
    const scopeSetupDone = cfg.setupCompletedScopeIds.includes(args.scopeId)
    const phase: LiveRun["phase"] =
      cfg.setupCommand && !scopeSetupDone ? "setup" : "start"

    // Rotate the logs collection ref so this run starts with a
    // clean slate. We can't "clear" a collection in place — it's
    // append-only — but we can point the field at a brand new
    // collectionId, which is the same pattern `sessions.ts` uses
    // for branch-rewriting the event log. Two reasons we do this
    // at run-start instead of run-end:
    //   1. After Stop the user almost always wants to scroll back
    //      through what just happened (build errors, server
    //      crash, etc.). Clearing on Stop would yank that out
    //      from under them.
    //   2. The barrier between two runs is `currentRunId`
    //      changing, which is exactly what we already write here.
    //      Rotating the collection in the same `update()`
    //      transaction means the renderer never sees a stale
    //      `currentRunId` paired with the previous run's logs.
    // The previous collection orphans on disk; that's fine — the
    // logs viewer is transient and the data isn't user-authored.
    const freshLogsRef = {
      collectionId: nanoid(),
      debugName: `play-logs-${args.workspaceId}-${runId}`,
    }
    await this.ctx.db.client.update(root => {
      const c = root.app.playConfigs[args.workspaceId]
      if (!c) return
      c.isRunning = true
      c.currentRunId = runId
      c.currentRunStartedAt = Date.now()
      c.logs = freshLogsRef as PlayConfig["logs"]
    })

    const startBanner =
      phase === "setup"
        ? `$ ${cfg.setupCommand}\n`
        : `$ ${cfg.startCommand}\n`
    const entry: LiveRun = {
      workspaceId: args.workspaceId,
      runId,
      scopeId: args.scopeId,
      child: this.spawnShell(
        phase === "setup" ? cfg.setupCommand! : cfg.startCommand,
        args.cwd,
        env,
      ),
      phase,
      startCommand: cfg.startCommand,
      cwd: args.cwd,
      pendingLogs: [],
      flushTimer: null,
      killTimer: null,
      killing: false,
    }
    this.live.set(args.workspaceId, entry)
    this.appendSystem(entry, startBanner)
    this.attachChild(entry, env)

    return { runId }
  }

  /**
   * Stop the running child for `workspaceId`. We send SIGINT
   * first — the same signal a Ctrl+C in a terminal would deliver,
   * which gives well-behaved dev servers a chance to flush state
   * and exit cleanly. If the child is still alive after
   * `SIGKILL_GRACE_MS`, we escalate to SIGKILL. A second click
   * while we're already in the grace window skips the grace and
   * goes straight to SIGKILL.
   *
   * When the child was spawned in its own process group (every
   * non-Windows platform — we use `detached: true`), we send the
   * signal to the whole group with `process.kill(-pgid, signal)`
   * so dev-server children of the shell receive it too. Without
   * this, killing just the shell would orphan whatever it spawned
   * (the actual `vite` / `next` / `node` process).
   */
  async stop(args: { workspaceId: string }): Promise<void> {
    const entry = this.live.get(args.workspaceId)
    if (!entry) {
      // Best-effort DB cleanup for the "DB says running, but no
      // live entry" case.
      const root = this.ctx.db.client.readRoot()
      const cfg = root.app.playConfigs[args.workspaceId]
      if (cfg?.isRunning) {
        await this.ctx.db.client.update(root => {
          const c = root.app.playConfigs[args.workspaceId]
          if (!c) return
          c.isRunning = false
          c.currentRunId = null
          c.currentRunStartedAt = null
        })
      }
      return
    }
    if (entry.killing) {
      // Second click during grace window — escalate now.
      this.signal(entry, "SIGKILL")
      this.appendSystem(entry, "\n[force kill]\n")
      return
    }
    entry.killing = true
    this.signal(entry, "SIGINT")
    this.appendSystem(entry, "\n[stop requested — SIGINT]\n")
    entry.killTimer = setTimeout(() => {
      entry.killTimer = null
      // The child's `exit` handler clears the live entry; if it's
      // still in the map we're past the grace window with no exit.
      if (this.live.get(args.workspaceId) !== entry) return
      this.signal(entry, "SIGKILL")
      this.appendSystem(
        entry,
        `\n[no exit after ${SIGKILL_GRACE_MS}ms — SIGKILL]\n`,
      )
    }, SIGKILL_GRACE_MS)
  }

  /**
   * Send `signal` to the entire process group of `entry.child`
   * when possible, falling back to a direct `child.kill()` if
   * the group send fails (e.g. the child already exited and the
   * group is gone). Errors are swallowed; this is best-effort.
   */
  private signal(entry: LiveRun, signal: NodeJS.Signals): void {
    const pid = entry.child.pid
    if (process.platform !== "win32" && typeof pid === "number" && pid > 0) {
      try {
        process.kill(-pid, signal)
        return
      } catch {
        // Process group gone or pid not a group leader — fall
        // through to direct kill.
      }
    }
    try {
      entry.child.kill(signal)
    } catch {}
  }

  /** Drop every log line for `workspaceId`. We don't actually
   * delete from the collection (it's append-only); the renderer
   * filters by `runId` and we just bump the run sentinel. Used by
   * a future "clear logs" button \u2014 not wired today. */
  async clearLogs(_args: { workspaceId: string }): Promise<void> {
    // intentionally empty for now
  }

  private spawnShell(
    command: string,
    cwd: string,
    env: NodeJS.ProcessEnv,
  ): ChildProcess {
    const shell = pickShell()
    // `-l -c` runs the command through a login shell so users get
    // the same PATH / nvm / asdf they'd see in iTerm. shell-env
    // already gives us the dotfile-derived PATH, but going through
    // the shell also picks up `function foo` / aliases defined in
    // .zshrc, which a bare child_process spawn would miss.
    return spawn(shell, ["-l", "-c", command], {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      // Allow killing the entire process tree. macOS detached
      // groups make grandchildren reachable by `kill -- -pid`.
      detached: process.platform !== "win32",
    })
  }

  private attachChild(entry: LiveRun, env: NodeJS.ProcessEnv): void {
    entry.child.stdout?.setEncoding("utf-8")
    entry.child.stderr?.setEncoding("utf-8")
    entry.child.stdout?.on("data", (data: string) => {
      this.appendLog(entry, "stdout", data)
    })
    entry.child.stderr?.on("data", (data: string) => {
      this.appendLog(entry, "stderr", data)
    })
    entry.child.on("error", err => {
      const msg = err instanceof Error ? err.message : String(err)
      this.appendSystem(entry, `\n[error] ${msg}\n`)
      this.ctx.rpc.emit.app.playExit({
        workspaceId: entry.workspaceId,
        runId: entry.runId,
        exitCode: null,
        error: msg,
      })
      void this.finalizeRun(entry, null)
    })
    entry.child.on("exit", code => {
      if (entry.phase === "setup" && code === 0) {
        // Setup finished cleanly — mark this scope as set-up,
        // banner, then spawn the start command in the same entry
        // so the renderer doesn't see two runs.
        this.appendSystem(entry, `\n[setup ok]\n$ ${entry.startCommand}\n`)
        void this.ctx.db.client.update(root => {
          const cfg = root.app.playConfigs[entry.workspaceId]
          if (!cfg) return
          if (!cfg.setupCompletedScopeIds.includes(entry.scopeId)) {
            cfg.setupCompletedScopeIds.push(entry.scopeId)
          }
        })
        entry.phase = "start"
        try {
          entry.child = this.spawnShell(entry.startCommand, entry.cwd, env)
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          this.appendSystem(entry, `\n[spawn failed] ${msg}\n`)
          void this.finalizeRun(entry, null)
          return
        }
        this.attachChild(entry, env)
        return
      }
      // Either the start command exited, or setup failed.
      const tag =
        code === 0
          ? "[done]"
          : entry.phase === "setup"
            ? `[setup failed: exit ${code}]`
            : `[exit ${code}]`
      this.appendSystem(entry, `\n${tag}\n`)
      this.ctx.rpc.emit.app.playExit({
        workspaceId: entry.workspaceId,
        runId: entry.runId,
        exitCode: code,
      })
      void this.finalizeRun(entry, code)
    })
  }

  private async finalizeRun(entry: LiveRun, _code: number | null): Promise<void> {
    if (this.live.get(entry.workspaceId) === entry) {
      this.live.delete(entry.workspaceId)
    }
    if (entry.flushTimer) {
      clearTimeout(entry.flushTimer)
      entry.flushTimer = null
    }
    if (entry.killTimer) {
      clearTimeout(entry.killTimer)
      entry.killTimer = null
    }
    entry.killing = false
    await this.flushAsync(entry)
    await this.ctx.db.client.update(root => {
      const cfg = root.app.playConfigs[entry.workspaceId]
      if (!cfg) return
      cfg.isRunning = false
      cfg.currentRunId = null
      cfg.currentRunStartedAt = null
    })
  }

  private appendLog(
    entry: LiveRun,
    stream: "stdout" | "stderr",
    data: string,
  ): void {
    entry.pendingLogs.push({
      ts: Date.now(),
      stream,
      data,
      runId: entry.runId,
    })
    this.ctx.rpc.emit.app.playLog({
      workspaceId: entry.workspaceId,
      runId: entry.runId,
      stream,
      data,
    })
    this.scheduleFlush(entry)
  }

  private appendSystem(entry: LiveRun, data: string): void {
    entry.pendingLogs.push({
      ts: Date.now(),
      stream: "system",
      data,
      runId: entry.runId,
    })
    this.ctx.rpc.emit.app.playLog({
      workspaceId: entry.workspaceId,
      runId: entry.runId,
      stream: "system",
      data,
    })
    this.scheduleFlush(entry)
  }

  private scheduleFlush(entry: LiveRun): void {
    if (entry.flushTimer) return
    entry.flushTimer = setTimeout(() => {
      entry.flushTimer = null
      this.flush(entry)
    }, LOG_FLUSH_MS)
  }

  private flush(entry: LiveRun): void {
    if (entry.pendingLogs.length === 0) return
    const batch = entry.pendingLogs
    entry.pendingLogs = []
    void this.ctx.db.client.app.playConfigs[entry.workspaceId]?.logs
      ?.concat(batch)
      .catch(err => {
        console.error("[play] logs.concat failed:", err)
      })
  }

  private async flushAsync(entry: LiveRun): Promise<void> {
    if (entry.pendingLogs.length === 0) return
    const batch = entry.pendingLogs
    entry.pendingLogs = []
    try {
      await this.ctx.db.client.app.playConfigs[entry.workspaceId]?.logs?.concat(
        batch,
      )
    } catch (err) {
      console.error("[play] logs.concat failed:", err)
    }
  }

  private async resolveEnv(): Promise<NodeJS.ProcessEnv> {
    if (this.cachedShellEnv) return this.cachedShellEnv
    try {
      const fromShell = await shellEnv()
      this.cachedShellEnv = {
        ...process.env,
        ...fromShell,
        // Make sure PATH is the shell's (which has nvm / brew /
        // asdf bins) rather than the parent process's. shell-env
        // already returns the merged PATH but we set it
        // explicitly so a stray process.env spread upstream of us
        // can't silently overwrite it.
        PATH: fromShell.PATH || process.env.PATH || "",
        HOME: process.env.HOME || os.homedir(),
      }
    } catch (err) {
      console.error("[play] shellEnv failed, falling back to process.env:", err)
      this.cachedShellEnv = { ...process.env }
    }
    return this.cachedShellEnv!
  }

  private async killEntry(entry: LiveRun): Promise<void> {
    // App is going down — no time for the SIGINT/grace dance.
    // SIGTERM the whole group so leftover dev-server children
    // don't survive us.
    this.signal(entry, "SIGTERM")
    if (entry.killTimer) {
      clearTimeout(entry.killTimer)
      entry.killTimer = null
    }
    if (entry.flushTimer) {
      clearTimeout(entry.flushTimer)
      entry.flushTimer = null
    }
  }
}

function normalize(input: string | null | undefined): string | null {
  if (input == null) return null
  const trimmed = input.trim()
  return trimmed.length === 0 ? null : trimmed
}

function pickShell(): string {
  if (process.platform === "win32") {
    return process.env.COMSPEC || "powershell.exe"
  }
  return process.env.SHELL || "/bin/bash"
}
