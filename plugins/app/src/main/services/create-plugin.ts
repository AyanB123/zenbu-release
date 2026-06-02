import fs from "node:fs"
import fsp from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { spawn } from "node:child_process"
import { nanoid } from "nanoid"
import { Service } from "@zenbujs/core/runtime"
import { RpcService } from "@zenbujs/core/services"
import { getBundledPaths } from "@zenbujs/core/env-bootstrap"

// Resolved at load time so we don't pay the cost on every create.
// The file is bundled into the host's `src/main/data/` so it
// ships with production builds (build config's `plugins/app/src/**`
// glob picks it up).
const PLUGIN_AUTHORING_GUIDE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "data",
  "plugin-authoring.md",
)

export type CreatePluginArgs = {
  /** Lowercase-hyphen plugin name. Must match `/^[a-z][a-z0-9-]*$/`. */
  name: string
}

export type CreatePluginResult = {
  runId: string
}

const PLUGIN_NAME_RE = /^[a-z][a-z0-9-]*$/

/**
 * Drives the "Create Plugin" action invoked from the marketplace
 * sidebar's inline Create pane.
 *
 * A plugin is now a single thing on disk: a standalone zenbu plugin
 * folder at `~/.zenbu/plugins/<name>`. The previous implementation
 * also created a git worktree of a "plugin host" workspace and
 * threaded the plugin into its `zenbu.config.ts`, but that flow
 * required the user to have a special `kind: "plugin"` workspace
 * configured ahead of time and made the Create flow fail
 * mysteriously on a fresh install.
 *
 * The simpler model:
 *
 *   1. Validate the name.
 *   2. Scaffold the plugin via `<bundled pnpm> dlx
 *      create-zenbu-app@latest --plugin --yes --no-git
 *      --depends-on app=<currentHost>/zenbu.config.ts <name>`,
 *      with cwd `~/.zenbu/plugins/`. The CLI lands the plugin at
 *      `~/.zenbu/plugins/<name>` and points its `dependsOn` at the
 *      currently-running host so the plugin gets typed access out
 *      of the box.
 *   3. Emit `createPluginDone { pluginName, pluginPath }`. The
 *      marketplace sidebar's handler picks that up and calls
 *      `pluginsRootView.openPluginInNewWindow`, which lazily
 *      creates a `kind: "plugin"` workspace + scope keyed by the
 *      plugin's name and opens a new window at `pluginPath` (see
 *      `plugin-window.ts`).
 *
 * Each step emits a `createPluginProgress` event so the renderer's
 * Creating\u2026 pane has something to render. The final
 * `createPluginDone` event ships `pluginPath` so the renderer can
 * skip the registry-mirror round-trip when opening the window.
 */
export class CreatePluginService extends Service.create({
  key: "createPlugin",
  deps: { rpc: RpcService },
}) {
  async createPlugin(args: CreatePluginArgs): Promise<CreatePluginResult> {
    const trimmed = args.name?.trim() ?? ""
    if (!trimmed) throw new Error("name is required")
    if (!PLUGIN_NAME_RE.test(trimmed)) {
      throw new Error(
        "name must be lowercase letters, digits, and hyphens (starts with a letter)",
      )
    }

    // Pre-flight collision check: the scaffold CLI errors with a
    // confusing "directory not empty" message if the plugin dir
    // already exists. Catch it here so the renderer gets a clean
    // error message before we even queue the microtask.
    const zenbuHome = path.join(os.homedir(), ".zenbu")
    const pluginsRoot = path.join(zenbuHome, "plugins")
    const pluginPath = path.join(pluginsRoot, trimmed)
    if (fs.existsSync(pluginPath)) {
      throw new Error(`${pluginPath} already exists`)
    }

    const runId = nanoid()
    queueMicrotask(() => {
      void this.run(runId, trimmed, pluginPath, pluginsRoot).catch(err => {
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

  private async run(
    runId: string,
    name: string,
    pluginPath: string,
    pluginsRoot: string,
  ): Promise<void> {
    const emit = this.ctx.rpc.emit.app
    const step = (line: string) =>
      emit.createPluginProgress({ runId, line, stream: "step" })

    // The plugin leaf is created by `create-zenbu-app`; ensure its
    // parent (`~/.zenbu/plugins/`) exists since the CLI doesn't
    // `mkdir -p` for you.
    await fsp.mkdir(pluginsRoot, { recursive: true })

    // Wire the new plugin into the currently-running host's
    // `zenbu.config.ts` via the scaffold's `--depends-on` flag. The
    // CLI uses this both to populate the plugin's `dependsOn`
    // (typed RPC + events) and to append the plugin to the host's
    // `plugins:` array so the next reload picks it up.
    //
    // Walk up from cwd to find the host's `zenbu.config.ts`. In
    // Electron the working directory at boot is the project root,
    // so this terminates on the first iteration; the loop is just
    // a defensive fallback.
    const hostRoot = findProjectRoot()
    const hostConfig = path.join(hostRoot, "zenbu.config.ts")
    const dependsOn = `app=${hostConfig}`

    // We don't shell out through `npx` because (a) `npx` may not
    // be on the user's $PATH and (b) we already ship a pinned
    // pnpm with the app, so using it makes the scaffold step
    // reproducible regardless of the user's system tooling. Falls
    // back to `pnpm` on $PATH if the bundled binary isn't
    // materialized yet (dev mode without a launcher having written
    // `~/.zenbu/.internal/paths.json`).
    step(`Scaffolding plugin (create-zenbu-app --plugin ${name})\u2026`)
    const pnpmBin = this.resolvePnpm()
    // `--no-add-to-host` keeps the scaffold from touching the
    // running host's `zenbu.config.ts#plugins[]`. Without it, the
    // CLI mutates the live config file, the framework's file
    // watcher sees the edit, hot-reloads the entire app mid-create,
    // and the renderer's create-pane gets torn down before the
    // `createPluginDone` event arrives. The plugin's own
    // `dependsOn` (typed access to the host) is still wired by the
    // `--depends-on` flag — only the host-config append is
    // skipped. The user installs the plugin into the host
    // explicitly later via the title-bar Install button.
    await this.spawnLogged(
      runId,
      pnpmBin,
      [
        "dlx",
        "create-zenbu-app@latest",
        "--plugin",
        "--yes",
        "--no-git",
        "--no-add-to-host",
        "--depends-on",
        dependsOn,
        name,
      ],
      { cwd: pluginsRoot },
    )

    if (!fs.existsSync(pluginPath)) {
      throw new Error(`scaffold finished but ${pluginPath} is missing`)
    }

    // Prepend the Zenbu plugin authoring guide to the scaffolded
    // plugin's AGENTS.md. The scaffold lands a framework-reference
    // AGENTS.md from create-zenbu-app's `templates/plugin/`; we
    // prepend our app-specific guide so the agent knows about
    // slots, events, the `app` plugin's DB layout, etc. Best-effort:
    // a missing source file (e.g. a stripped dev tree) or a
    // missing target shouldn't fail the create.
    try {
      const agentsTarget = path.join(pluginPath, "AGENTS.md")
      const guide = await fsp.readFile(
        PLUGIN_AUTHORING_GUIDE_PATH,
        "utf-8",
      )
      const existing = fs.existsSync(agentsTarget)
        ? await fsp.readFile(agentsTarget, "utf-8")
        : ""
      await fsp.writeFile(
        agentsTarget,
        guide + "\n\n---\n\n" + existing,
      )
    } catch (err) {
      step(
        `Warning: could not prepend plugin authoring guide: ${
          err instanceof Error ? err.message : String(err)
        }`,
      )
    }

    step("Done.")
    emit.createPluginDone({
      runId,
      ok: true,
      pluginName: name,
      pluginPath,
    })
  }

  /**
   * Locate the bundled pnpm binary the launcher materializes into
   * `~/Library/Caches/Zenbu/bin/pnpm`. We read its path from the
   * `getBundledPaths()` framework API so a future move of the
   * cache dir doesn't fork this lookup. Falls back to `pnpm` on
   * $PATH when the file isn't there (dev mode without a launcher).
   */
  private resolvePnpm(): string {
    try {
      const paths = getBundledPaths()
      if (paths.pnpmPath) return paths.pnpmPath
    } catch {}
    return "pnpm"
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
}

/**
 * Walk up from `process.cwd()` looking for a directory that
 * contains `zenbu.config.ts`. Inlined here (instead of imported
 * from the plugin-installer plugin) because the host `app` plugin
 * sits at the bottom of the dependency graph and shouldn't take a
 * dep on a downstream plugin.
 */
function findProjectRoot(startDir?: string): string {
  let dir = startDir ?? process.cwd()
  for (let i = 0; i < 12; i++) {
    if (fs.existsSync(path.join(dir, "zenbu.config.ts"))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return startDir ?? process.cwd()
}
