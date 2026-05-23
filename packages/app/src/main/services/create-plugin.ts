import fs from "node:fs"
import fsp from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"
import { nanoid } from "nanoid"
import { Service } from "@zenbujs/core/runtime"
import { DbService, RpcService } from "@zenbujs/core/services"
import { ReposService } from "./repos"

export type CreatePluginArgs = {
  /** Lowercase-hyphen plugin name. Must match `/^[a-z][a-z0-9-]*$/`. */
  name: string
}

export type CreatePluginResult = {
  runId: string
}

const PLUGIN_NAME_RE = /^[a-z][a-z0-9-]*$/

/**
 * Drives the "Create Plugin" action available from the sentinel
 * workspace's New Chat split-button dropdown.
 *
 * Layout note: a plugin is two adjacent things on disk, not one.
 *
 *   - The **plugin source** is a standalone zenbu plugin folder at
 *     `~/.zenbu/plugins/<name>`. It does NOT live inside the host
 *     repo's `packages/` — that's the monorepo nesting we
 *     explicitly want to avoid for scalability + portability.
 *   - The **worktree** is a git worktree of the *sentinel* (host
 *     app source) repo at `~/.zenbu/plugin-worktrees/<name>`, on a
 *     fresh branch `<name>`. The chat scope's primary cwd is this
 *     worktree, so the agent has full access to the host app's
 *     source when it needs to wire the new plugin into things
 *     (e.g. add it to `zenbu.config.ts`, depend on its types,
 *     etc.). Per-plugin worktrees keep parallel plugin work
 *     isolated and reversible (delete the branch + worktree = the
 *     plugin's host wiring is gone).
 *
 * The plugin path is added to the scope's `extraDirectories` so
 * `SessionsService` injects its AGENTS.md and a "this dir is
 * available" line into the system prompt. From the agent's point
 * of view, both directories are first-class working directories.
 *
 * Pipeline (each step streams a `createPluginProgress` event so the
 * dialog log keeps moving; one final `createPluginDone` emits on
 * exit with `{ scopeId, chatId }` on success):
 *
 *   1. Resolve sentinel workspace + sentinel scope's repoId.
 *   2. `ReposService.createWorktree` at the worktree path on
 *      branch `<name>`.
 *   3. `npx create-zenbu-app --plugin --yes --no-git --depends-on
 *      app=<worktree>/zenbu.config.ts <name>` with cwd =
 *      `~/.zenbu/plugins/`, so the scaffold lands at
 *      `~/.zenbu/plugins/<name>` and the CLI wires the plugin into
 *      the worktree's host config.
 *   4. Prepend an AGENTS.md prelude to the worktree root (the
 *      agent's cwd) describing where the plugin lives. The
 *      plugin's own AGENTS.md ships with the scaffold's zenbu
 *      docs and is loaded automatically via `extraDirectories`.
 *   5. Materialize a sentinel-workspace scope at the worktree path
 *      with `extraDirectories = [pluginPath]` and `pluginName =
 *      <name>`, plus a pending chat in it.
 */
export class CreatePluginService extends Service.create({
  key: "createPlugin",
  deps: { rpc: RpcService, db: DbService, repos: ReposService },
}) {
  async createPlugin(args: CreatePluginArgs): Promise<CreatePluginResult> {
    const trimmed = args.name?.trim() ?? ""
    if (!trimmed) throw new Error("name is required")
    if (!PLUGIN_NAME_RE.test(trimmed)) {
      throw new Error(
        "name must be lowercase letters, digits, and hyphens (starts with a letter)",
      )
    }
    const runId = nanoid()
    queueMicrotask(() => {
      void this.run(runId, trimmed).catch(err => {
        const message = err instanceof Error ? err.message : String(err)
        this.ctx.rpc.emit.app.createPluginDone({
          runId,
          ok: false,
          error: message,
        })
      })
    })
    return { runId }
  }

  private async run(runId: string, name: string): Promise<void> {
    const emit = this.ctx.rpc.emit.app
    const step = (line: string) =>
      emit.createPluginProgress({ runId, line, stream: "step" })

    // -- 1. Locate sentinel workspace + repo
    const root = this.ctx.db.client.readRoot()
    const sentinel = Object.values(root.app.workspaces).find(
      w => w.sentinel,
    )
    if (!sentinel) {
      throw new Error("sentinel workspace not found")
    }
    const sentinelScope = Object.values(root.app.scopes).find(
      s => s.workspaceId === sentinel.id && !s.archived && !s.completed,
    )
    const repoId = sentinelScope?.repoId ?? null
    if (!repoId) {
      throw new Error(
        "sentinel workspace has no repo \u2014 cannot create a worktree for the plugin",
      )
    }
    const repo = root.app.repos[repoId]
    if (!repo) throw new Error(`unknown repo ${repoId}`)

    const zenbuHome = path.join(os.homedir(), ".zenbu")
    const pluginsRoot = path.join(zenbuHome, "plugins")
    const worktreesRoot = path.join(zenbuHome, "plugin-worktrees")
    const pluginPath = path.join(pluginsRoot, name)
    const worktreePath = path.join(worktreesRoot, name)

    if (fs.existsSync(pluginPath)) {
      throw new Error(`${pluginPath} already exists`)
    }
    if (fs.existsSync(worktreePath)) {
      throw new Error(`${worktreePath} already exists`)
    }

    // Both leaves are created by their respective tools (git +
    // create-zenbu-app), but neither tool runs `mkdir -p` on the
    // parent dir. Make sure both parents exist first.
    await fsp.mkdir(pluginsRoot, { recursive: true })
    await fsp.mkdir(worktreesRoot, { recursive: true })

    // -- 2. Worktree
    step(`Creating git worktree at ${worktreePath} (branch ${name})\u2026`)
    const wtResult = await this.ctx.repos.createWorktree({
      repoId,
      worktreePath,
      branch: name,
      sourceRef: undefined,
      createBranch: true,
    })
    if (!wtResult.ok) {
      throw new Error(wtResult.error ?? "git worktree add failed")
    }
    step("Worktree created.")

    // -- 3. Scaffold the plugin at ~/.zenbu/plugins/<name>
    //
    // We point `--depends-on app=<worktree>/zenbu.config.ts` at the
    // worktree's host config, which is what the scaffold treats as
    // the "host". Without `--no-add-to-host` this also appends the
    // new plugin to that host config's `plugins:` array, so the
    // worktree's dev server can load it. `--no-git` is required
    // because the parent dir (`~/.zenbu/plugins`) isn't itself a
    // git repo and we don't want the CLI to init one for us.
    const hostConfig = path.join(worktreePath, "zenbu.config.ts")
    const dependsOn = `app=${hostConfig}`
    step(`Scaffolding plugin (create-zenbu-app --plugin ${name})\u2026`)
    await this.spawnLogged(runId, "npx", [
      "-y",
      "create-zenbu-app@latest",
      "--plugin",
      "--yes",
      "--no-git",
      "--depends-on",
      dependsOn,
      name,
    ], { cwd: pluginsRoot })

    if (!fs.existsSync(pluginPath)) {
      throw new Error(`scaffold finished but ${pluginPath} is missing`)
    }

    // -- 4. AGENTS.md prelude at the worktree root.
    //
    // The chat scope below points at the worktree, so this is the
    // AGENTS.md the agent reads at the start of every turn. The
    // plugin's own AGENTS.md (under `~/.zenbu/plugins/<name>/`)
    // ships with the scaffold's full zenbu docs and is loaded
    // automatically via `SessionsService`' extra-dirs injection;
    // we don't need to touch it.
    step("Updating AGENTS.md\u2026")
    await this.prependAgentsPrelude(worktreePath, name, pluginPath)

    // -- 5. Materialize sentinel-workspace scope + chat
    step("Materializing sidebar entry\u2026")
    const scopeId = nanoid()
    const chatId = nanoid()
    const now = Date.now()
    const workspaceId = sentinel.id
    await this.ctx.db.client.update(root => {
      // Guard against a parallel `import-worktrees` materializing
      // the same path first. Reuse if so, then tag it as a plugin
      // scope and make sure the plugin dir is in extraDirectories.
      const existing = Object.values(root.app.scopes).find(
        s => s.workspaceId === workspaceId && s.directory === worktreePath,
      )
      const finalScopeId = existing?.id ?? scopeId
      if (!existing) {
        root.app.scopes[finalScopeId] = {
          id: finalScopeId,
          workspaceId,
          directory: worktreePath,
          repoId,
          extraDirectories: [pluginPath],
          createdAt: now,
          archived: false,
          completed: false,
          archivedAt: null,
          completedAt: null,
          pluginName: name,
        }
      } else {
        if (existing.archived) {
          existing.archived = false
          existing.archivedAt = null
        }
        if (existing.completed) {
          existing.completed = false
          existing.completedAt = null
        }
        existing.pluginName = name
        if (!existing.extraDirectories.includes(pluginPath)) {
          existing.extraDirectories = [
            ...existing.extraDirectories,
            pluginPath,
          ]
        }
      }
      root.app.chats[chatId] = {
        id: chatId,
        scopeId: finalScopeId,
        session: { kind: "pending" },
        createdAt: now,
      }
    })

    step("Done.")
    emit.createPluginDone({
      runId,
      ok: true,
      pluginName: name,
      worktreePath,
      scopeId,
      chatId,
    })
  }

  private spawnLogged(
    runId: string,
    cmd: string,
    cmdArgs: string[],
    opts: { cwd: string },
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(cmd, cmdArgs, {
        cwd: opts.cwd,
        env: { ...process.env, CI: "1", FORCE_COLOR: "0" },
        stdio: ["ignore", "pipe", "pipe"],
      })
      const emit = this.ctx.rpc.emit.app
      const pumpLines = (stream: "stdout" | "stderr") => {
        let buffer = ""
        const source = stream === "stdout" ? child.stdout : child.stderr
        source?.on("data", (chunk: Buffer) => {
          buffer += chunk.toString("utf-8")
          let idx: number
          while ((idx = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, idx)
            buffer = buffer.slice(idx + 1)
            if (line.length > 0) {
              emit.createPluginProgress({ runId, line, stream })
            }
          }
        })
        source?.on("end", () => {
          if (buffer.length > 0) {
            emit.createPluginProgress({ runId, line: buffer, stream })
            buffer = ""
          }
        })
      }
      pumpLines("stdout")
      pumpLines("stderr")
      child.on("error", err => reject(err))
      child.on("exit", (code, signal) => {
        if (code === 0) {
          resolve()
        } else if (signal) {
          reject(new Error(`${cmd} terminated by ${signal}`))
        } else {
          reject(new Error(`${cmd} exited with code ${code}`))
        }
      })
    })
  }

  /**
   * Prepend a short header to the worktree root's AGENTS.md so the
   * agent immediately knows it's working in a plugin development
   * sandbox and where the plugin source actually lives. The plugin
   * source path is also in `scope.extraDirectories`, so
   * `SessionsService` will load that dir's own AGENTS.md (the
   * scaffold template inlines the full zenbu docs there).
   */
  private async prependAgentsPrelude(
    worktreePath: string,
    name: string,
    pluginPath: string,
  ): Promise<void> {
    const agentsPath = path.join(worktreePath, "AGENTS.md")
    let existing = ""
    try {
      existing = await fsp.readFile(agentsPath, "utf-8")
    } catch (err) {
      // AGENTS.md may legitimately be missing. Treat that as
      // "write a fresh file with just our prelude".
      existing = ""
    }
    const prelude =
      `# Plugin: ${name}\n\n` +
      `You are helping the user build a new Zenbu.js plugin named \`${name}\`.\n\n` +
      `**Primary working directory (cwd):** \`${worktreePath}\` \u2014 a git worktree\n` +
      `of the host app's source on branch \`${name}\`. Use this when you need to\n` +
      `wire the new plugin into the host (\`zenbu.config.ts\`, host types, etc.).\n\n` +
      `**Plugin source directory:** \`${pluginPath}\` \u2014 the standalone plugin\n` +
      `folder. This is in the session's \`extraDirectories\`, so its AGENTS.md\n` +
      `(which contains the Zenbu.js documentation) is already loaded into your\n` +
      `context. When the user asks you to make changes to "the plugin", default\n` +
      `to editing files under \`${pluginPath}\`.\n\n` +
      `Keep changes scoped to the plugin folder unless the user explicitly asks\n` +
      `you to modify the host worktree.\n\n` +
      `---\n\n`
    await fsp.writeFile(agentsPath, prelude + existing, "utf-8")
  }
}
