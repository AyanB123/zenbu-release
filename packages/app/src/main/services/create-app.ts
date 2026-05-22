import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"
import { shell } from "electron"
import { nanoid } from "nanoid"
import { Service } from "@zenbujs/core/runtime"
import { RpcService } from "@zenbujs/core/services"

export type CreateDesktopAppArgs = {
  name: string
  iconPath?: string
  force?: boolean
}

/**
 * Wraps the `create-desktop-app` npm CLI (which itself shells to
 * `create-zenbu-app --desktop`). Spawns the process with `--yes` so it
 * never prompts; streams every stdout / stderr line as a
 * `createAppProgress` event keyed by `runId`, then emits one final
 * `createAppDone`. Returns the runId synchronously so the renderer can
 * filter events for the current run.
 */
export class CreateAppService extends Service.create({
  key: "createApp",
  deps: { rpc: RpcService },
}) {
  async createDesktopApp(args: CreateDesktopAppArgs): Promise<{ runId: string }> {
    const trimmed = args.name?.trim()
    if (!trimmed) throw new Error("name is required")

    const runId = nanoid()
    const cliArgs = ["-y", "create-desktop-app@latest", "--yes", trimmed]
    if (args.iconPath) cliArgs.push("--icon", args.iconPath)
    if (args.force) cliArgs.push("--force")

    queueMicrotask(() => this.run(runId, trimmed, cliArgs))
    return { runId }
  }

  private run(runId: string, displayName: string, cliArgs: string[]) {
    const emitter = this.ctx.rpc.emit.app
    const child = spawn("npx", cliArgs, {
      env: { ...process.env, CI: "1", FORCE_COLOR: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    })

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
            emitter.createAppProgress({ runId, line, stream })
          }
        }
      })
      source?.on("end", () => {
        if (buffer.length > 0) {
          emitter.createAppProgress({ runId, line: buffer, stream })
          buffer = ""
        }
      })
    }
    pumpLines("stdout")
    pumpLines("stderr")

    child.on("error", err => {
      emitter.createAppDone({ runId, ok: false, error: err.message })
    })
    child.on("exit", (code, signal) => {
      const ok = code === 0
      const error = ok
        ? undefined
        : signal
          ? `terminated by ${signal}`
          : `exit code ${code}`
      const appPath = ok ? resolveAppPath(displayName) : undefined
      emitter.createAppDone({ runId, ok, error, appPath })
      if (ok && appPath) {
        console.log("[create-app] launching", appPath)
        void shell.openPath(appPath).then(err => {
          if (err) {
            console.error("[create-app] shell.openPath failed:", err)
          }
        })
      }
    })
  }
}

/**
 * Mirror of `defaultDestApp` from `create-zenbu-app/desktop/index.ts`:
 * the CLI installs the bundle to `/Applications/<displayName>.app` when
 * that dir is writable, otherwise `~/Applications/<displayName>.app`.
 * Whichever location actually has the bundle now is the one we launch.
 */
function resolveAppPath(displayName: string): string | undefined {
  const candidates = [
    path.join("/Applications", `${displayName}.app`),
    path.join(os.homedir(), "Applications", `${displayName}.app`),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  // The bundle should exist at one of the two canonical paths after a
  // successful run; if neither does, log so it's debuggable instead of
  // silently swallowed.
  console.warn(
    "[create-app] bundle not found at expected paths:",
    candidates.join(", "),
  )
  return undefined
}
